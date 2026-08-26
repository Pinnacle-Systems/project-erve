#!/usr/bin/env bash
# Extracts an already-uploaded, checksum-verified artifact into a new
# immutable release, migrates the database, and atomically activates it.
# Runs on the VPS only, invoked over SSH by
# .github/workflows/deploy-production.yml. Never builds source, never
# clones/pulls Git.
#
# Usage: deploy-release.sh <full-git-sha>
#
# Required environment: DEPLOY_ROOT, APP_PORT
# Optional environment: ERVE_BASE_URL (enables the public HTTPS check)
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

erve_require_env DEPLOY_ROOT APP_PORT

SHA="${1:?Usage: deploy-release.sh <full-git-sha>}"
erve_validate_full_sha "$SHA"

DEPLOY_ROOT="$(realpath -e "$DEPLOY_ROOT")" || erve_die "DEPLOY_ROOT does not exist: $DEPLOY_ROOT"
RELEASES_DIR="$DEPLOY_ROOT/releases"
SHARED_DIR="$DEPLOY_ROOT/shared"
CURRENT_LINK="$DEPLOY_ROOT/current"
INCOMING_DIR="$DEPLOY_ROOT/.deploy/incoming"
FAILED_DIR="$DEPLOY_ROOT/.deploy/failed"
LOCK_DIR="$DEPLOY_ROOT/.deploy/deployment.lock"

ARTIFACT_PATH="$INCOMING_DIR/erve-release-${SHA}.tar.gz"
CHECKSUM_PATH="${ARTIFACT_PATH}.sha256"

[ -f "$ARTIFACT_PATH" ] || erve_die "Artifact not found: $ARTIFACT_PATH"
[ -f "$CHECKSUM_PATH" ] || erve_die "Checksum file not found: $CHECKSUM_PATH"

mkdir -p "$RELEASES_DIR" "$SHARED_DIR/backups" "$SHARED_DIR/mobile-updates/bundles" "$SHARED_DIR/uploads" "$DEPLOY_ROOT/.deploy/incoming" "$DEPLOY_ROOT/.deploy/failed"

erve_acquire_lock "$LOCK_DIR"

# A directory is created before preparation and migrations, so its mere
# existence is never proof that it is an immutable completed release.
STATE_FILE_NAME=".erve-release-state"
RELEASE_DIR="$RELEASES_DIR/$SHA"
DEPLOY_STATE_FILE=""
DEPLOY_STATE=""

write_release_state() {
  local state="$1" tmp
  [ -n "$DEPLOY_STATE_FILE" ] || return 0
  tmp="${DEPLOY_STATE_FILE}.tmp.$$"
  { printf 'version=1\n'; printf 'artifact_sha256=%s\n' "$ACTUAL_SHA256"; printf 'state=%s\n' "$state"; } > "$tmp"
  mv -f "$tmp" "$DEPLOY_STATE_FILE"
  DEPLOY_STATE="$state"
  erve_log "Release state recorded: $state"
}

deploy_exit() {
  local status="$?"
  if [ "$status" -ne 0 ] && [ -n "$DEPLOY_STATE_FILE" ] && [ -d "$RELEASE_DIR" ] && [ "$DEPLOY_STATE" != completed ] && [ "$DEPLOY_STATE" != activated ]; then
    write_release_state failed || true
    erve_log "Release left recoverable after failed deployment: $RELEASE_DIR"
  fi
  erve_release_lock
  exit "$status"
}
trap deploy_exit EXIT
trap 'exit 128' HUP INT TERM

erve_log "Verifying artifact checksum"
EXPECTED_SHA256="$(cat "$CHECKSUM_PATH")"
ACTUAL_SHA256="$(sha256sum "$ARTIFACT_PATH" | awk '{print $1}')"
[ "$EXPECTED_SHA256" = "$ACTUAL_SHA256" ] || erve_die "Artifact checksum mismatch (expected $EXPECTED_SHA256, got $ACTUAL_SHA256)"

if [ -e "$RELEASE_DIR" ]; then
  [ -d "$RELEASE_DIR" ] || erve_die "Release path exists but is not a directory; refusing to operate on it: $RELEASE_DIR"
  erve_assert_inside_dir "$RELEASE_DIR" "$RELEASES_DIR"
  RELEASE_DIR="$(realpath -e "$RELEASE_DIR")"
  ACTIVE_RELEASE=""
  if [ -L "$CURRENT_LINK" ] || [ -e "$CURRENT_LINK" ]; then
    ACTIVE_RELEASE="$(erve_resolve_release_dir "$CURRENT_LINK" "$RELEASES_DIR")"
    erve_log "Active-release protection: current resolves to $ACTIVE_RELEASE"
  fi
  [ "$RELEASE_DIR" != "$ACTIVE_RELEASE" ] || erve_die "Refusing to recover or overwrite active release: $RELEASE_DIR"
  DEPLOY_STATE_FILE="$RELEASE_DIR/$STATE_FILE_NAME"
  if [ -f "$DEPLOY_STATE_FILE" ]; then
    DEPLOY_STATE="$(sed -n 's/^state=//p' "$DEPLOY_STATE_FILE" | tail -n 1)"
    STORED_SHA256="$(sed -n 's/^artifact_sha256=//p' "$DEPLOY_STATE_FILE" | tail -n 1)"
    case "$DEPLOY_STATE" in
      completed|activated)
        erve_log "Existing completed release state detected: $DEPLOY_STATE"
        [ -n "$STORED_SHA256" ] || erve_die "Completed release has no stored artifact checksum; refusing to modify it: $RELEASE_DIR"
        [ "$STORED_SHA256" = "$ACTUAL_SHA256" ] || erve_die "Checksum mismatch for completed release $RELEASE_DIR; refusing to modify immutable release"
        erve_log "Completed-release checksum verified; identical artifact already deployed. Skipping safely."
        exit 0
        ;;
      created|extracted|preparing|migrating|failed|"")
        erve_log "Existing incomplete release state detected: ${DEPLOY_STATE:-legacy/unmarked}; recovering it under deployment lock"
        erve_log "Removing failed or incomplete release before deterministic recreation: $RELEASE_DIR"
        rm -rf "$RELEASE_DIR"
        DEPLOY_STATE_FILE=""
        DEPLOY_STATE=""
        ;;
      *) erve_die "Unknown release state '$DEPLOY_STATE' in $DEPLOY_STATE_FILE; refusing to modify release" ;;
    esac
  else
    erve_log "Existing incomplete release state detected: legacy/unmarked; recovering it under deployment lock"
    erve_log "Removing failed or incomplete release before deterministic recreation: $RELEASE_DIR"
    rm -rf "$RELEASE_DIR"
  fi
fi

ARTIFACT_BYTES="$(stat -c%s "$ARTIFACT_PATH")"
erve_check_disk_space "$DEPLOY_ROOT" "$ARTIFACT_BYTES"

mkdir -p "$RELEASE_DIR"
DEPLOY_STATE_FILE="$RELEASE_DIR/$STATE_FILE_NAME"
write_release_state created

erve_log "Extracting artifact into $RELEASE_DIR"
tar -xzf "$ARTIFACT_PATH" -C "$RELEASE_DIR" --strip-components=1
write_release_state extracted

erve_log "Validating extracted release structure"
for required in api/server.js api/admin-bootstrap.js api/roles-bootstrap.js api/quality-bootstrap.js api/financial-year-bootstrap.js api/package.json api/prisma.config.ts api/prisma/schema.prisma api/ecosystem.config.cjs web/index.html deployment-metadata.json; do
  if [ ! -e "$RELEASE_DIR/$required" ]; then
    erve_die "Extracted release is missing required path: $required — a partially extracted release must never become active"
  fi
done

erve_log "Release extracted: $RELEASE_DIR"

erve_load_node24

# Proves the extracted release's node_modules actually load, not merely
# that the expected paths exist — an artifact can pass the path check
# above and still be missing package content underneath (this is what
# happened in production: iconv-lite's lib/index.js was present but its
# encodings/ directory was not, and node_modules/.bin/prisma existing says
# nothing about whether express itself can actually load). Runs before any
# database connection, migration, or symlink activation, so a broken
# release is caught and left in place under releases/ (never activated,
# never cleaned up automatically) rather than taking down the running API.
write_release_state preparing
erve_log "Verifying extracted release runtime dependencies before activating it"
"$SCRIPT_DIR/verify-artifact-deps.sh" "$RELEASE_DIR/api" || erve_die "Extracted release failed runtime dependency verification — release NOT activated: $RELEASE_DIR"

erve_log "Linking shared runtime configuration into the release"
[ -e "$SHARED_DIR/api.env" ] || erve_die "Missing $SHARED_DIR/api.env — create it manually before the first deployment (see DEPLOYMENT.md)"
ln -sfn "$SHARED_DIR/api.env" "$RELEASE_DIR/api/.env"

erve_log "Verifying production database connectivity"
set -a
# SC1090/SC1091: this path is only known at deploy time (a real production
# secrets file that must never be committed to the repo, so there is
# nothing on disk for ShellCheck to statically resolve or follow).
# shellcheck disable=SC1090,SC1091
. "$SHARED_DIR/api.env"
set +a
erve_require_env DATABASE_URL
psql "$(erve_libpq_url "$DATABASE_URL")" -tAc "SELECT 1;" >/dev/null || erve_die "Could not connect to the production database"

erve_log "Backing up the production database before migrating"
"$SCRIPT_DIR/backup-database.sh"

[ -x "$RELEASE_DIR/api/node_modules/.bin/prisma" ] || erve_die "Release is missing node_modules/.bin/prisma — packaging must install production dependencies on the build runner"

erve_log "Applying production database migrations"
write_release_state migrating
if ! (cd "$RELEASE_DIR/api" && ./node_modules/.bin/prisma migrate deploy --schema=prisma/schema.prisma); then
  erve_die "Production migration failed — deployment aborted, release NOT activated. A database backup was taken before this step."
fi

PREVIOUS_TARGET=""
# -e alone would miss a broken symlink (readlink -f target that no longer
# exists); -L alone would miss a wrong-type entry (e.g. a plain directory
# where a symlink should be). Together they mean "something exists at
# this path" as opposed to "genuinely nothing yet" (first-ever deploy),
# in which case erve_resolve_release_dir's fail-closed validation applies.
if [ -L "$CURRENT_LINK" ] || [ -e "$CURRENT_LINK" ]; then
  PREVIOUS_TARGET="$(erve_resolve_release_dir "$CURRENT_LINK" "$RELEASES_DIR")"
fi

erve_log "Atomically activating release $SHA"
TMP_LINK="$DEPLOY_ROOT/current.tmp.$$"
ln -sfn "$RELEASE_DIR" "$TMP_LINK"
mv -T "$TMP_LINK" "$CURRENT_LINK"

# erve_activate_pm2_release (lib/common.sh) is the one shared function used
# both here and in the rollback branch immediately below: it binds PM2
# directly to the given release directory (never through $CURRENT_LINK —
# see the background note in lib/common.sh on why that distinction is the
# whole fix), asserts PM2 actually resolved to it, and only then runs the
# local health check. `pm2 save` is deliberately never called until
# whichever attempt (this one, or the rollback below) actually passes its
# health check — a failed release's PM2 definition must never be persisted.
if erve_activate_pm2_release "$RELEASE_DIR" "$APP_PORT"; then
  erve_log "Activation health checks passed — saving PM2 process list"
  pm2 save
  write_release_state completed
  write_release_state activated
  erve_log "Release marked completed and activated: $RELEASE_DIR"
else
  erve_log "Health checks failed after activation — rolling back application (not the database migration)"
  ROLLBACK_STATUS="no-previous"
  if [ -n "$PREVIOUS_TARGET" ]; then
    ln -sfn "$PREVIOUS_TARGET" "$CURRENT_LINK"
    if erve_activate_pm2_release "$PREVIOUS_TARGET" "$APP_PORT"; then
      erve_log "Rollback health check passed — saving PM2 process list for the restored release"
      pm2 save
      ROLLBACK_STATUS="ok"
    else
      ROLLBACK_STATUS="failed"
    fi
  fi
  mkdir -p "$FAILED_DIR"
  mv "$RELEASE_DIR" "$FAILED_DIR/${SHA}-$(date -u +%Y%m%dT%H%M%SZ)"
  case "$ROLLBACK_STATUS" in
    ok)
      erve_die "Deployment failed post-activation health checks; rolled back to previous release ($PREVIOUS_TARGET). NOTE: any migration applied above was not reversed."
      ;;
    failed)
      erve_die "Deployment failed post-activation health checks AND rollback to previous release ($PREVIOUS_TARGET) also failed its health check — PM2 currently targets $PREVIOUS_TARGET but its process list was NOT saved; manual intervention required. NOTE: any migration applied above was not reversed."
      ;;
    *)
      erve_die "Deployment failed post-activation health checks; no previous release was recorded to roll back to. NOTE: any migration applied above was not reversed."
      ;;
  esac
fi

if [ -n "$PREVIOUS_TARGET" ]; then
  erve_log "Recording previous known-good release for retention cleanup: $PREVIOUS_TARGET"
  printf '%s\n' "$(basename "$PREVIOUS_TARGET")" > "$DEPLOY_ROOT/.deploy/previous-release.tmp"
  mv -T "$DEPLOY_ROOT/.deploy/previous-release.tmp" "$DEPLOY_ROOT/.deploy/previous-release"
fi

if [ -n "${ERVE_BASE_URL:-}" ]; then
  erve_log "Running public health checks against $ERVE_BASE_URL"
  "$SCRIPT_DIR/verify-release.sh" public "$ERVE_BASE_URL" || erve_log "WARNING: public health check failed (local checks passed — investigate Nginx routing, not the application)"
fi

erve_log "Cleaning up incoming artifact"
rm -f "$ARTIFACT_PATH" "$CHECKSUM_PATH"

erve_log "Running release retention cleanup"
"$SCRIPT_DIR/cleanup-releases.sh"

erve_log "Deployment complete: SHA=$SHA release=$RELEASE_DIR current=$(readlink -f "$CURRENT_LINK")"
