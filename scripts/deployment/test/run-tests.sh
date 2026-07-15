#!/usr/bin/env bash
# Runs every scripts/deployment/test/*.test.sh fixture-based test file and
# reports a summary. No VPS, network, or real database required.
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

FAILED=0

for test_file in "$SCRIPT_DIR"/*.test.sh; do
  echo "=== $(basename "$test_file") ==="
  if ! bash "$test_file"; then
    FAILED=1
  fi
  echo
done

if [ "$FAILED" -ne 0 ]; then
  echo "One or more deployment script test files failed"
  exit 1
fi

echo "All deployment script tests passed"
