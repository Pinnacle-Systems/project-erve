#!/usr/bin/env bash
# Health-check helper shared by deploy-release.sh and rollback-release.sh
# (via lib/common.sh's erve_activate_pm2_release).
#
# Usage:
#   verify-release.sh local  <APP_PORT> <APP_NAME>
#   verify-release.sh public <BASE_URL>
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

MODE="${1:?Usage: verify-release.sh <local PORT APP_NAME | public BASE_URL>}"
TARGET="${2:?Usage: verify-release.sh <local PORT APP_NAME | public BASE_URL>}"

# Overridable only for the test suite (to keep fixture tests fast); every
# real deployment/rollback call site relies on these defaults.
MAX_ATTEMPTS="${ERVE_HEALTH_CHECK_ATTEMPTS:-10}"
SLEEP_SECONDS="${ERVE_HEALTH_CHECK_SLEEP_SECONDS:-2}"

# check_endpoint URL [APP_NAME]
# Retries URL up to MAX_ATTEMPTS times. When APP_NAME is given, also
# re-checks PM2's own view of that process on every attempt — an `online`
# status is necessary but not sufficient for a passing health check (see
# erve_activate_pm2_release's assertion, which runs before this is ever
# called), but a process that stops being `online` partway through this
# retry loop is a much faster and more useful signal than silently
# exhausting every remaining curl retry. When that happens, this prints
# the process's recent PM2 logs and fails immediately instead of waiting
# out the rest of the retry budget.
check_endpoint() {
  local url="$1" app_name="${2:-}" attempt=0 pm2_status
  while [ "$attempt" -lt "$MAX_ATTEMPTS" ]; do
    if curl -fsS -m 5 "$url" >/dev/null; then
      return 0
    fi
    if [ -n "$app_name" ]; then
      pm2_status="$(erve_pm2_process_status "$app_name")"
      if [ "$pm2_status" != "online" ]; then
        erve_log "PM2 process '$app_name' is no longer online (status: ${pm2_status:-<absent or ambiguous>}) — failing fast instead of exhausting retries"
        erve_log "Recent logs for '$app_name':"
        pm2 logs "$app_name" --lines 50 --nostream 2>&1 | sed 's/^/  /' >&2 || erve_log "(could not retrieve PM2 logs for '$app_name')"
        return 1
      fi
    fi
    attempt=$((attempt + 1))
    sleep "$SLEEP_SECONDS"
  done
  return 1
}

case "$MODE" in
  local)
    PORT="$TARGET"
    APP_NAME="${3:?Usage: verify-release.sh local <APP_PORT> <APP_NAME>}"
    erve_log "Checking local health endpoints on 127.0.0.1:$PORT (PM2 process: $APP_NAME)"
    check_endpoint "http://127.0.0.1:${PORT}/health" "$APP_NAME" || erve_die "Local /health check failed"
    check_endpoint "http://127.0.0.1:${PORT}/ready" "$APP_NAME" || erve_die "Local /ready check failed"
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
