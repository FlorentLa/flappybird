#!/usr/bin/env bash
# =============================================================================
# deploy.sh — CDK deploy wrapper for scaffold-aws demos.
#
# Usage: bash scripts/deploy.sh <env>
#   env = "dev" | "demo"   (PoC/demo deploy targets — never a "prod" env)
#
# When running under GitHub Actions (CI=true), drops --profile.
# Distills CDK outputs -> config.json -> S3 (no-store) + CloudFront invalidation.
# =============================================================================
set -euo pipefail

ENV="${1:?Usage: deploy.sh <dev|demo>}"

if [[ "$ENV" != "dev" && "$ENV" != "demo" ]]; then
  echo "ERROR: env must be 'dev' or 'demo', got '$ENV'" >&2
  exit 1
fi

CDK_ARGS="--all -c env=$ENV --require-approval never --outputs-file cdk-outputs-${ENV}.json"

# Under CI, no profile needed (credentials come from OIDC/task role).
# Locally, use AWS_PROFILE if set.
if [[ "${CI:-}" != "true" && -n "${AWS_PROFILE:-}" ]]; then
  CDK_ARGS="$CDK_ARGS --profile $AWS_PROFILE"
fi

# Build the SPA FIRST so the CDK WebStack's BucketDeployment ships the real bundle.
# Without this, modules/web/dist/ doesn't exist at synth/deploy time and CDK ships
# its placeholder "Web bundle not yet deployed" index.html instead of the app.
if [[ -f "modules/web/package.json" ]]; then
  echo "==> Building modules/web (SPA) -> dist/"
  npm run build -w modules/web
fi

echo "==> Deploying env=$ENV"
cd infra
npx cdk deploy $CDK_ARGS

echo "==> Deploy complete. Outputs in infra/cdk-outputs-${ENV}.json"

# If a web stack exists, distill the runtime config.json, push it to S3
# (no-store), and invalidate CloudFront. The SPA fetches /config.json at boot
# (never baked into the bundle) so one build runs across envs — keys must match
# what modules/web reads: region, userPoolId, userPoolClientId, graphqlUrl, envName.
#
# CDK outputs are keyed by stack name -> output logical id (UserPoolId,
# UserPoolClientId, GraphqlUrl, WebBucketName, DistributionId, SiteUrl). The
# recursive `.. | .Name?` walk finds each regardless of which stack carries it.
OUTPUTS_FILE="cdk-outputs-${ENV}.json"
if [[ -f "$OUTPUTS_FILE" ]]; then
  WEB_BUCKET=$(jq -r '[.. | objects | .WebBucketName? // empty] | first // empty' "$OUTPUTS_FILE")
  DIST_ID=$(jq -r '[.. | objects | .DistributionId? // empty] | first // empty' "$OUTPUTS_FILE")
  GRAPHQL_URL=$(jq -r '[.. | objects | .GraphqlUrl? // empty] | first // empty' "$OUTPUTS_FILE")
  USER_POOL_ID=$(jq -r '[.. | objects | .UserPoolId? // empty] | first // empty' "$OUTPUTS_FILE")
  CLIENT_ID=$(jq -r '[.. | objects | .UserPoolClientId? // empty] | first // empty' "$OUTPUTS_FILE")

  if [[ -n "$WEB_BUCKET" ]]; then
    echo "==> Generating config.json from CDK outputs"
    CONFIG_FILE="../modules/web/public/config.json"
    mkdir -p "$(dirname "$CONFIG_FILE")"
    jq -n \
      --arg region "${AWS_REGION:-${CDK_DEFAULT_REGION:-us-west-2}}" \
      --arg userPoolId "$USER_POOL_ID" \
      --arg userPoolClientId "$CLIENT_ID" \
      --arg graphqlUrl "$GRAPHQL_URL" \
      --arg envName "$ENV" \
      '{ region: $region, userPoolId: $userPoolId, userPoolClientId: $userPoolClientId, graphqlUrl: $graphqlUrl, envName: $envName }' \
      > "$CONFIG_FILE"

    # no-store so the SPA always re-reads the current deploy's endpoints.
    aws s3 cp "$CONFIG_FILE" "s3://$WEB_BUCKET/config.json" \
      --cache-control "no-store, max-age=0" --content-type "application/json"

    if [[ -n "$DIST_ID" ]]; then
      echo "==> Invalidating CloudFront distribution $DIST_ID"
      # CloudFront is a us-east-1 control plane regardless of workload region.
      aws cloudfront create-invalidation --distribution-id "$DIST_ID" \
        --paths "/config.json" "/index.html" --region us-east-1 --no-cli-pager || true
    fi

    SITE_URL=$(jq -r '[.. | objects | .SiteUrl? // empty] | first // empty' "$OUTPUTS_FILE")
    [[ -n "$SITE_URL" ]] && echo "==> Site: $SITE_URL"
  fi
fi

echo "==> Done."
