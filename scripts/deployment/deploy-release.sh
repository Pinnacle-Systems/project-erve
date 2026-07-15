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

erve_log "Verifying artifact checksum"
EXPECTED_SHA256="$(cat "$CHECKSUM_PATH")"
ACTUAL_SHA256="$(sha256sum "$ARTIFACT_PATH" | awk '{print $1}')"
[ "$EXPECTED_SHA256" = "$ACTUAL_SHA256" ] || erve_die "Artifact checksum mismatch (expected $EXPECTED_SHA256, got $ACTUAL_SHA256)"

RELEASE_DIR="$RELEASES_DIR/$SHA"
if [ -e "$RELEASE_DIR" ]; then
  erve_die "Release directory already exists, refusing to overwrite an existing different release: $RELEASE_DIR"
fi

ARTIFACT_BYTES="$(stat -c%s "$ARTIFACT_PATH")"
erve_check_disk_space "$DEPLOY_ROOT" "$ARTIFACT_BYTES"

PARTIAL_DIR="${RELEASE_DIR}.partial"
rm -rf "$PARTIAL_DIR"
mkdir -p "$PARTIAL_DIR"

erve_log "Extracting artifact into $PARTIAL_DIR"
tar -xzf "$ARTIFACT_PATH" -C "$PARTIAL_DIR" --strip-components=1

erve_log "Validating extracted release structure"
for required in api/server.js api/package.json api/prisma/schema.prisma api/ecosystem.config.cjs web/index.html deployment-metadata.json; do
  if [ ! -e "$PARTIAL_DIR/$required" ]; then
    rm -rf "$PARTIAL_DIR"
    erve_die "Extracted release is missing required path: $required — a partially extracted release must never become active"
  fi
done

mv "$PARTIAL_DIR" "$RELEASE_DIR"
erve_log "Release extracted: $RELEASE_DIR"

erve_log "Linking shared runtime configuration into the release"
[ -e "$SHARED_DIR/api.env" ] || erve_die "Missing $SHARED_DIR/api.env — create it manually before the first deployment (see DEPLOYMENT.md)"
ln -sfn "$SHARED_DIR/api.env" "$RELEASE_DIR/api/.env"

erve_load_node24

erve_log "Verifying production database connectivity"
set -a
# SC1090/SC1091: this path is only known at deploy time (a real production
# secrets file that must never be committed to the repo, so there is
# nothing on disk for ShellCheck to statically resolve or follow).
# shellcheck disable=SC1090,SC1091
. "$SHARED_DIR/api.env"
set +a
erve_require_env DATABASE_URL
psql "$DATABASE_URL" -tAc "SELECT 1;" >/dev/null || erve_die "Could not connect to the production database"

erve_log "Backing up the production database before migrating"
"$SCRIPT_DIR/backup-database.sh"

[ -x "$RELEASE_DIR/api/node_modules/.bin/prisma" ] || erve_die "Release is missing node_modules/.bin/prisma — packaging must install production dependencies on the build runner"

erve_log "Applying production database migrations"
if ! (cd "$RELEASE_DIR/api" && ./node_modules/.bin/prisma migrate deploy --schema=prisma/schema.prisma); then
  erve_die "Production migration failed — deployment aborted, release NOT activated. A database backup was taken before this step."
fi

PREVIOUS_TARGET=""
if [ -L "$CURRENT_LINK" ]; then
  PREVIOUS_TARGET="$(readlink -f "$CURRENT_LINK")"
fi

erve_log "Atomically activating release $SHA"
TMP_LINK="$DEPLOY_ROOT/current.tmp.$$"
ln -sfn "$RELEASE_DIR" "$TMP_LINK"
mv -T "$TMP_LINK" "$CURRENT_LINK"

erve_log "Reloading PM2"
pm2 startOrReload "$CURRENT_LINK/api/ecosystem.config.cjs" --only erve-api --update-env
pm2 save

erve_log "Running local health checks"
if ! "$SCRIPT_DIR/verify-release.sh" local "$APP_PORT"; then
  erve_log "Health checks failed after activation — rolling back application (not the database migration)"
  if [ -n "$PREVIOUS_TARGET" ]; then
    ln -sfn "$PREVIOUS_TARGET" "$CURRENT_LINK"
    pm2 startOrReload "$CURRENT_LINK/api/ecosystem.config.cjs" --only erve-api --update-env
    pm2 save
    "$SCRIPT_DIR/verify-release.sh" local "$APP_PORT" || erve_log "WARNING: rollback health check also failed — manual intervention required"
  fi
  mkdir -p "$FAILED_DIR"
  mv "$RELEASE_DIR" "$FAILED_DIR/${SHA}-$(date -u +%Y%m%dT%H%M%SZ)"
  erve_die "Deployment failed post-activation health checks; rolled back to previous release${PREVIOUS_TARGET:+ ($PREVIOUS_TARGET)}. NOTE: any migration applied above was not reversed."
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
