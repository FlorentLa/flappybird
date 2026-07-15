#!/usr/bin/env bash
# =============================================================================
# check-guardrails.sh — HARD GATE on the five mandatory security guardrails.
#
# Scans every synthesized CloudFormation template in cdk.out/ and exits
# non-zero on ANY violation. Run AFTER `cdk synth` and BEFORE `cdk deploy`.
# A non-zero exit MUST abort the whole scaffold/deploy run.
#
# Guardrails:
#   #1 Cognito  : every UserPool has AdminCreateUserConfig.AllowAdminCreateUserOnly == true
#   #2 S3       : every Bucket has a fully-locked PublicAccessBlockConfiguration (all 4 true);
#                 no BucketPolicy statement grants s3:Get* to Principal "*" without a
#                 SourceArn / OAC condition
#   #3 Lambda   : no AWS::Lambda::Url resource exists
#   #4 ELB      : no internet-facing LoadBalancer; no Listener on port 80
#   #5 No public data-plane bypass of the auth layer:
#                 - no API Gateway REST method / HTTP-API route with AuthorizationType "NONE"
#                   (anonymous public endpoint reaching the backend/data store)
#                 - no AWS::RDS::DBInstance with PubliclyAccessible == true
#                 NOTE: JWT / SigV4 / IAM / COGNITO_USER_POOLS / CUSTOM authorizers and
#                 AgentCore Runtime endpoints are AUTHENTICATED ingress and are NOT bypasses.
# =============================================================================
set -euo pipefail

CDK_OUT="${1:-cdk.out}"

if ! command -v jq >/dev/null 2>&1; then
  echo "FATAL: jq is required for the guardrail gate but was not found on PATH." >&2
  exit 2
fi

if [[ ! -d "$CDK_OUT" ]]; then
  echo "FATAL: cdk.out directory '$CDK_OUT' not found. Run 'cdk synth' first." >&2
  exit 2
fi

# Collect templates safely (NUL-delimited; portable to bash 3.2 on macOS, which
# has no `mapfile`). Handles spaces / newlines in paths.
TEMPLATES=()
while IFS= read -r -d '' f; do
  TEMPLATES+=("$f")
done < <(find "$CDK_OUT" -maxdepth 1 -type f -name '*.template.json' -print0)

if [[ ${#TEMPLATES[@]} -eq 0 ]]; then
  echo "FATAL: no *.template.json files in '$CDK_OUT'. Did 'cdk synth' run?" >&2
  exit 2
fi

violations=0
note() { echo "  VIOLATION: $*" >&2; violations=$((violations + 1)); }

for tpl in "${TEMPLATES[@]}"; do
  echo "==> Scanning $(basename "$tpl")"

  # --- Validate JSON up front so a malformed template can't silently pass. ---
  if ! jq -e . "$tpl" >/dev/null 2>&1; then
    echo "  FATAL: $tpl is not valid JSON." >&2
    exit 2
  fi

  # ---- GUARDRAIL #1: Cognito self-signup disabled --------------------------
  # Fail if any UserPool lacks AllowAdminCreateUserOnly == true (boolean true
  # OR the string "true", since CFN may render either).
  bad_pools="$(
    jq -r '
      (.Resources // {}) | to_entries[]
      | select(.value.Type == "AWS::Cognito::UserPool")
      | select(
          (.value.Properties.AdminCreateUserConfig.AllowAdminCreateUserOnly) as $a
          | ($a == true or $a == "true") | not
        )
      | .key
    ' "$tpl"
  )"
  if [[ -n "$bad_pools" ]]; then
    while IFS= read -r p; do
      note "[#1 Cognito] UserPool '$p' allows self-signup (AdminCreateUserConfig.AllowAdminCreateUserOnly != true)."
    done <<< "$bad_pools"
  fi

  # ---- GUARDRAIL #2a: every S3 bucket fully locks public access ------------
  # All four PublicAccessBlockConfiguration flags must be true.
  bad_buckets="$(
    jq -r '
      (.Resources // {}) | to_entries[]
      | select(.value.Type == "AWS::S3::Bucket")
      | .value.Properties.PublicAccessBlockConfiguration as $pab
      | select(
          ($pab == null)
          or ((($pab.BlockPublicAcls)       | (. == true or . == "true")) | not)
          or ((($pab.BlockPublicPolicy)      | (. == true or . == "true")) | not)
          or ((($pab.IgnorePublicAcls)       | (. == true or . == "true")) | not)
          or ((($pab.RestrictPublicBuckets)  | (. == true or . == "true")) | not)
        )
      | .key
    ' "$tpl"
  )"
  if [[ -n "$bad_buckets" ]]; then
    while IFS= read -r b; do
      note "[#2 S3] Bucket '$b' lacks a fully-locked PublicAccessBlockConfiguration (all four flags must be true)."
    done <<< "$bad_buckets"
  fi

  # ---- GUARDRAIL #2b: no public s3:Get* without a SourceArn/OAC condition --
  # Flag any BucketPolicy statement that is Effect Allow, has a wildcard
  # Principal ("*" or {AWS|Service:"*"}), grants an s3:Get* action, and carries
  # NO Condition (an OAC grant always has aws:SourceArn under Condition).
  bad_policies="$(
    jq -r '
      def princ_wild($p):
        ($p == "*")
        or ($p == {"AWS": "*"})
        or (($p | type == "object") and (
              ((.AWS // empty) | if type=="array" then index("*") != null else . == "*" end)
              or ((.Service // empty) | if type=="array" then index("*") != null else . == "*" end)
            ));
      def is_get($a):
        ($a | type == "string" and (ascii_downcase | test("^s3:get")))
        or ($a | type == "array" and (map(ascii_downcase) | any(test("^s3:get"))));
      (.Resources // {}) | to_entries[]
      | select(.value.Type == "AWS::S3::BucketPolicy")
      | .key as $id
      | ( .value.Properties.PolicyDocument.Statement
          | if type == "array" then . else [.] end ) as $stmts
      | $stmts[]
      | select((.Effect // "Allow") == "Allow")
      | select(princ_wild(.Principal))
      | select(is_get(.Action))
      | select((.Condition // null) == null)
      | $id
    ' "$tpl"
  )"
  if [[ -n "$bad_policies" ]]; then
    while IFS= read -r bp; do
      note "[#2 S3] BucketPolicy '$bp' grants s3:Get* to Principal '*' with no aws:SourceArn/OAC condition."
    done <<< "$bad_policies"
  fi

  # ---- GUARDRAIL #3: no Lambda Function URL --------------------------------
  bad_urls="$(
    jq -r '
      (.Resources // {}) | to_entries[]
      | select(.value.Type == "AWS::Lambda::Url")
      | .key
    ' "$tpl"
  )"
  if [[ -n "$bad_urls" ]]; then
    while IFS= read -r u; do
      note "[#3 Lambda] Function URL resource '$u' is forbidden — invoke Lambdas via AppSync behind Cognito."
    done <<< "$bad_urls"
  fi

  # ---- GUARDRAIL #4a: no internet-facing load balancer ---------------------
  bad_albs="$(
    jq -r '
      (.Resources // {}) | to_entries[]
      | select(.value.Type == "AWS::ElasticLoadBalancingV2::LoadBalancer")
      | select((.value.Properties.Scheme // "") == "internet-facing")
      | .key
    ' "$tpl"
  )"
  if [[ -n "$bad_albs" ]]; then
    while IFS= read -r lb; do
      note "[#4 ELB] LoadBalancer '$lb' is internet-facing — only internal, HTTPS-only ALBs are allowed."
    done <<< "$bad_albs"
  fi

  # ---- GUARDRAIL #4b: no listener on port 80 -------------------------------
  bad_listeners="$(
    jq -r '
      (.Resources // {}) | to_entries[]
      | select(.value.Type == "AWS::ElasticLoadBalancingV2::Listener")
      | (.value.Properties.Port) as $port
      | select($port == 80 or $port == "80")
      | .key
    ' "$tpl"
  )"
  if [[ -n "$bad_listeners" ]]; then
    while IFS= read -r ls; do
      note "[#4 ELB] Listener '$ls' is on port 80 — plaintext HTTP ingress is forbidden (HTTPS only)."
    done <<< "$bad_listeners"
  fi

  # ---- GUARDRAIL #5a: no anonymous API Gateway REST method -----------------
  # An AWS::ApiGateway::Method with AuthorizationType "NONE" is an unauthenticated
  # public entry point into the backend/data plane. (OPTIONS = CORS preflight is
  # exempt — it carries no data and AWS requires it to be NONE.)
  bad_rest="$(
    jq -r '
      (.Resources // {}) | to_entries[]
      | select(.value.Type == "AWS::ApiGateway::Method")
      | select((.value.Properties.HttpMethod // "") != "OPTIONS")
      | select((.value.Properties.AuthorizationType // "NONE") == "NONE")
      | .key
    ' "$tpl"
  )"
  if [[ -n "$bad_rest" ]]; then
    while IFS= read -r m; do
      note "[#5 Auth-bypass] API Gateway method '$m' has AuthorizationType NONE — a public, unauthenticated path to the backend. Put it behind COGNITO_USER_POOLS / AWS_IAM / a CUSTOM authorizer."
    done <<< "$bad_rest"
  fi

  # ---- GUARDRAIL #5b: no anonymous HTTP-API (v2) route ---------------------
  # AWS::ApiGatewayV2::Route with AuthorizationType "NONE" and no attached
  # authorizer is an open route. ($default OPTIONS handling aside, any NONE route
  # is a data-plane bypass.)
  bad_http="$(
    jq -r '
      (.Resources // {}) | to_entries[]
      | select(.value.Type == "AWS::ApiGatewayV2::Route")
      | select((.value.Properties.AuthorizationType // "NONE") == "NONE")
      | select((.value.Properties.AuthorizerId // null) == null)
      | .key
    ' "$tpl"
  )"
  if [[ -n "$bad_http" ]]; then
    while IFS= read -r r; do
      note "[#5 Auth-bypass] HTTP-API route '$r' has AuthorizationType NONE and no authorizer — an open public route. Attach a JWT / IAM / Lambda authorizer."
    done <<< "$bad_http"
  fi

  # ---- GUARDRAIL #5c: no publicly-accessible RDS ---------------------------
  bad_rds="$(
    jq -r '
      (.Resources // {}) | to_entries[]
      | select(.value.Type == "AWS::RDS::DBInstance")
      | (.value.Properties.PubliclyAccessible) as $p
      | select($p == true or $p == "true")
      | .key
    ' "$tpl"
  )"
  if [[ -n "$bad_rds" ]]; then
    while IFS= read -r db; do
      note "[#5 Auth-bypass] RDS instance '$db' is PubliclyAccessible — the data store must be private (VPC-only), reached through the app's auth layer."
    done <<< "$bad_rds"
  fi
done

echo
if [[ $violations -gt 0 ]]; then
  echo "GUARDRAIL CHECK FAILED: $violations violation(s) found. Deploy aborted." >&2
  exit 1
fi

echo "GUARDRAIL CHECK PASSED: all five guardrails satisfied across ${#TEMPLATES[@]} template(s)."
exit 0
