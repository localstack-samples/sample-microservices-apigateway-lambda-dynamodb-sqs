#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# CDK Integration Tests for Friend Microservices against LocalStack
# ============================================================================
# Usage:
#   ./run-integ-tests.sh              # Run all tests
#   ./run-integ-tests.sh --no-clean   # Keep stacks after test (for debugging)
#   ./run-integ-tests.sh --force      # Force re-run even if snapshots match
# ============================================================================

LOCALSTACK_ENDPOINT="${AWS_ENDPOINT_URL:-http://localhost.localstack.cloud:4566}"
S3_ENDPOINT="${AWS_ENDPOINT_URL_S3:-http://s3.localhost.localstack.cloud:4566}"

# Common env vars for LocalStack
export AWS_ENDPOINT_URL="${LOCALSTACK_ENDPOINT}"
export AWS_ENDPOINT_URL_S3="${S3_ENDPOINT}"
export AWS_ACCESS_KEY_ID="test"
export AWS_SECRET_ACCESS_KEY="test"
export AWS_DEFAULT_REGION="us-east-1"
export AWS_REGION="us-east-1"
export CDK_DEFAULT_ACCOUNT="000000000000"
export CDK_DEFAULT_REGION="us-east-1"
export NODE_TLS_REJECT_UNAUTHORIZED="0"

echo "==> Checking LocalStack is running..."
if ! curl -s "http://localhost:4566/_localstack/health" > /dev/null 2>&1; then
  echo "ERROR: LocalStack is not running."
  echo "Start it with: localstack start -d"
  exit 1
fi
echo "    LocalStack is running."

# Build TypeScript
echo "==> Building TypeScript..."
npx tsc

# Bootstrap CDK on LocalStack
echo "==> Bootstrapping CDK on LocalStack..."
npx cdklocal bootstrap aws://000000000000/us-east-1 --force 2>&1 || true

# Run integ-runner
echo ""
echo "==> Running integration tests against LocalStack..."
echo "    Endpoint: ${LOCALSTACK_ENDPOINT}"
echo ""

npx integ-runner \
  --directory ./integ-tests \
  --parallel-regions us-east-1 \
  --update-on-failed \
  --verbose \
  "$@"

echo ""
echo "==> Integration tests completed successfully!"
