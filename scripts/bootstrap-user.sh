#!/usr/bin/env bash
# Admin-provision a Cognito user for FlappyBird (self-signup is disabled).
set -euo pipefail

EMAIL=""
PASSWORD=""
ENV="demo"
PROFILE="${AWS_PROFILE:-}"
USER_POOL_ID=""

usage() {
  echo "Usage: $0 --email <e> [--password <p>] [--env demo|dev] [--profile <p>] [--user-pool-id <id>]" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --email)        EMAIL="$2"; shift 2 ;;
    --password)     PASSWORD="$2"; shift 2 ;;
    --env)          ENV="$2"; shift 2 ;;
    --profile)      PROFILE="$2"; shift 2 ;;
    --user-pool-id) USER_POOL_ID="$2"; shift 2 ;;
    -h|--help)      usage ;;
    *) echo "Unknown argument: $1" >&2; usage ;;
  esac
done

[[ -n "$EMAIL" ]] || { echo "Error: --email is required" >&2; usage; }

# Resolve the User Pool id from CDK outputs when not passed explicitly.
if [[ -z "$USER_POOL_ID" ]]; then
  OUTPUTS="cdk-outputs-${ENV}.json"
  [[ -f "$OUTPUTS" ]] || { echo "Error: ${OUTPUTS} not found; pass --user-pool-id" >&2; exit 1; }
  USER_POOL_ID="$(jq -r '[.. | objects | to_entries[] | select(.key | test("UserPoolId$")) | .value] | first // empty' "$OUTPUTS")"
  [[ -n "$USER_POOL_ID" ]] || { echo "Error: could not find a UserPoolId in ${OUTPUTS}" >&2; exit 1; }
fi

# Drop --profile inside CI / when no profile is set (GitHub Actions OIDC or an
# ECS task role supplies credentials via the environment; locally use AWS_PROFILE
# or --profile). Self-signup is OFF (guardrail #1) so this admin path is the only
# way a user is created.
PROFILE_ARG=()
if [[ "${CI:-}" != "true" && -n "$PROFILE" ]]; then
  PROFILE_ARG=(--profile "$PROFILE")
fi

aws cognito-idp admin-create-user \
  "${PROFILE_ARG[@]}" \
  --user-pool-id "$USER_POOL_ID" \
  --username "$EMAIL" \
  --message-action SUPPRESS \
  --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true

if [[ -n "$PASSWORD" ]]; then
  aws cognito-idp admin-set-user-password \
    "${PROFILE_ARG[@]}" \
    --user-pool-id "$USER_POOL_ID" \
    --username "$EMAIL" \
    --password "$PASSWORD" \
    --permanent
fi

echo "Provisioned Cognito user: ${EMAIL} (pool ${USER_POOL_ID})"
