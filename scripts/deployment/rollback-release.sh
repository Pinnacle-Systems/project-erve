#!/usr/bin/env bash
# Manually rolls back to a previously deployed, already-extracted release.
# Only accepts a full Git SHA that corresponds to an existing release
# directory under ${DEPLOY_ROOT}/releases/ — never an arbitrary path.
# Does NOT reverse Prisma migrations.
#
# Usage: rollback-release.sh <full-git-sha>
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

erve_require_env DEPLOY_ROOT APP_PORT

SHA="${1:?Usage: rollback-release.sh <full-git-sha>}"
erve_validate_full_sha "$SHA"

DEPLOY_ROOT="$(realpath -e "$DEPLOY_ROOT")" || erve_die "DEPLOY_ROOT does not exist: $DEPLOY_ROOT"
RELEASES_DIR="$DEPLOY_ROOT/releases"
CURRENT_LINK="$DEPLOY_ROOT/current"
LOCK_DIR="$DEPLOY_ROOT/.deploy/deployment.lock"

TARGET_RELEASE="$RELEASES_DIR/$SHA"
[ -e "$TARGET_RELEASE" ] || erve_die "No release found for SHA $SHA under $RELEASES_DIR"
erve_assert_inside_dir "$TARGET_RELEASE" "$RELEASES_DIR"

for required in api/server.js api/package.json api/ecosystem.config.cjs web/index.html; do
  [ -e "$TARGET_RELEASE/$required" ] || erve_die "Release $SHA is missing expected path '$required' — refusing to roll back to an incomplete release"
done

erve_acquire_lock "$LOCK_DIR"

PREVIOUS_TARGET=""
if [ -L "$CURRENT_LINK" ]; then
  PREVIOUS_TARGET="$(readlink -f "$CURRENT_LINK")"
fi

if [ "$PREVIOUS_TARGET" = "$TARGET_RELEASE" ]; then
  erve_log "Release $SHA is already active, nothing to do"
  exit 0
fi

erve_load_node24

erve_log "Rolling back to release $SHA"
TMP_LINK="$DEPLOY_ROOT/current.tmp.$$"
ln -sfn "$TARGET_RELEASE" "$TMP_LINK"
mv -T "$TMP_LINK" "$CURRENT_LINK"

pm2 startOrReload "$CURRENT_LINK/api/ecosystem.config.cjs" --only erve-api --update-env
pm2 save

if ! "$SCRIPT_DIR/verify-release.sh" local "$APP_PORT"; then
  erve_log "Rollback target failed health checks — restoring the previously active release"
  if [ -n "$PREVIOUS_TARGET" ]; then
    ln -sfn "$PREVIOUS_TARGET" "$CURRENT_LINK"
    pm2 startOrReload "$CURRENT_LINK/api/ecosystem.config.cjs" --only erve-api --update-env
    pm2 save
  fi
  erve_die "Rollback to $SHA failed health checks; restored previous release${PREVIOUS_TARGET:+ ($PREVIOUS_TARGET)}. Prisma migrations were NOT reversed — verify schema compatibility manually before retrying."
fi

if [ -n "${ERVE_BASE_URL:-}" ]; then
  "$SCRIPT_DIR/verify-release.sh" public "$ERVE_BASE_URL" || erve_log "WARNING: public health check failed after rollback"
fi

mkdir -p "$DEPLOY_ROOT/.deploy"
ROLLBACK_LOG="$DEPLOY_ROOT/.deploy/rollback-history.log"
printf '%s rolled_back_from=%s rolled_back_to=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${PREVIOUS_TARGET:-none}" "$TARGET_RELEASE" >> "$ROLLBACK_LOG"

erve_log "Rollback complete: now serving $SHA"
erve_log "NOTE: database migrations are not automatically reversed by rollback. If $SHA predates a non-backward-compatible migration, the application may be incompatible with the current database schema — verify manually."
