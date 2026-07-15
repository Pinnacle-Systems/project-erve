#!/usr/bin/env bash
# Health-check helper shared by deploy-release.sh and rollback-release.sh.
#
# Usage:
#   verify-release.sh local  <APP_PORT>
#   verify-release.sh public <BASE_URL>
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

MODE="${1:?Usage: verify-release.sh <local PORT | public BASE_URL>}"
TARGET="${2:?Usage: verify-release.sh <local PORT | public BASE_URL>}"

check_endpoint() {
  local url="$1" attempt=0 max_attempts=10
  while [ "$attempt" -lt "$max_attempts" ]; do
    if curl -fsS -m 5 "$url" >/dev/null; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 2
  done
  return 1
}

case "$MODE" in
  local)
    PORT="$TARGET"
    erve_log "Checking local health endpoints on 127.0.0.1:$PORT"
    check_endpoint "http://127.0.0.1:${PORT}/health" || erve_die "Local /health check failed"
    check_endpoint "http://127.0.0.1:${PORT}/ready" || erve_die "Local /ready check failed"
    ;;
  public)
    BASE_URL="$TARGET"
    erve_log "Checking public health endpoints at $BASE_URL"
    check_endpoint "${BASE_URL}/api/health" || erve_die "Public /api/health check failed"
    check_endpoint "${BASE_URL}/api/ready" || erve_die "Public /api/ready check failed"
    ;;
  *)
    erve_die "Unknown mode: $MODE (expected 'local' or 'public')"
    ;;
esac

erve_log "Health checks passed ($MODE)"
