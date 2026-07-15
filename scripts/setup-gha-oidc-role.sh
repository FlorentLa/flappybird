#!/usr/bin/env bash
# =============================================================================
# setup-gha-oidc-role.sh — Create or find the GitHub Actions OIDC deploy role
# for FlorentLa/flappybird and set DEPLOY_ROLE_ARN in the "demo" env.
#
# Requires: AWS credentials with iam:CreateRole, iam:AttachRolePolicy,
#           iam:GetRole, and iam:CreateOpenIDConnectProvider permissions.
# Usage:
#   AWS_PROFILE=<admin-profile> bash scripts/setup-gha-oidc-role.sh
#   GH_TOKEN=<token> is optional; if set, sets the secret automatically.
# =============================================================================
set -euo pipefail

ACCOUNT="519956515742"
REGION="us-west-2"
ROLE_NAME="FlappyBird-GHA-Deploy"
REPO="FlorentLa/flappybird"
GH_ENV="demo"

echo "==> Account: $ACCOUNT  Region: $REGION"

# ── 1. Ensure GitHub OIDC provider exists ────────────────────────────────────
OIDC_URL="https://token.actions.githubusercontent.com"
OIDC_ARN="arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"
THUMBPRINT="6938fd4d98bab03faadb97b34396831e3780aea1"

if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" \
    2>/dev/null | grep -q OpenIDConnectProviderArn 2>/dev/null || \
   aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" \
    2>/dev/null | grep -q Url; then
  echo "==> OIDC provider already exists: $OIDC_ARN"
else
  echo "==> Creating GitHub OIDC provider..."
  aws iam create-open-id-connect-provider \
    --url "$OIDC_URL" \
    --client-id-list "sts.amazonaws.com" \
    --thumbprint-list "$THUMBPRINT"
  echo "==> Created: $OIDC_ARN"
fi

# ── 2. Create or reuse the deploy role ───────────────────────────────────────
TRUST_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "${OIDC_ARN}"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:${REPO}:*"
        }
      }
    }
  ]
}
EOF
)

ROLE_ARN="arn:aws:iam::${ACCOUNT}:role/${ROLE_NAME}"

if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "==> Role already exists: $ROLE_ARN"
else
  echo "==> Creating IAM role $ROLE_NAME ..."
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "$TRUST_POLICY" \
    --description "GitHub Actions OIDC deploy role for $REPO" \
    --tags Key=repo,Value="${REPO//\//-}" Key=managed-by,Value=setup-gha-oidc-role

  aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn "arn:aws:iam::aws:policy/AdministratorAccess"

  echo "==> Created and attached AdministratorAccess: $ROLE_ARN"
fi

# ── 3. Set the GitHub secret ─────────────────────────────────────────────────
if [[ -n "${GH_TOKEN:-}" ]]; then
  echo "==> Setting DEPLOY_ROLE_ARN in GitHub env '$GH_ENV' ..."
  GH_TOKEN="$GH_TOKEN" gh secret set DEPLOY_ROLE_ARN \
    --body "$ROLE_ARN" \
    --env "$GH_ENV" \
    -R "$REPO"
  echo "==> Secret set."
else
  echo ""
  echo "==> GH_TOKEN not set. Run this manually to set the secret:"
  echo "    gh secret set DEPLOY_ROLE_ARN --body '$ROLE_ARN' --env $GH_ENV -R $REPO"
fi

echo ""
echo "==> Done. DEPLOY_ROLE_ARN = $ROLE_ARN"
