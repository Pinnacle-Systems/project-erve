#!/usr/bin/env bash
# Creates a timestamped custom-format pg_dump backup of the production
# database under ${DEPLOY_ROOT}/shared/backups/ before a migration runs,
# then runs backup-retention cleanup (see cleanup-backups.sh) once that
# backup is confirmed non-empty. Never prints DATABASE_URL. Fails if the
# resulting backup file is empty.
#
# On-VPS retention is not a substitute for off-server backup storage — see
# DEPLOYMENT.md for the off-VPS backup and restore-testing requirements.
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

erve_require_env DEPLOY_ROOT

DEPLOY_ROOT="$(realpath -e "$DEPLOY_ROOT")" || erve_die "DEPLOY_ROOT does not exist: $DEPLOY_ROOT"
SHARED_DIR="$DEPLOY_ROOT/shared"
BACKUP_DIR="$SHARED_DIR/backups"
ENV_FILE="$SHARED_DIR/api.env"

[ -f "$ENV_FILE" ] || erve_die "Missing $ENV_FILE — create it before running any deployment (see DEPLOYMENT.md)"

set -a
# SC1090/SC1091: this path is only known at deploy time (a real production
# secrets file that must never be committed to the repo, so there is
# nothing on disk for ShellCheck to statically resolve or follow).
# shellcheck disable=SC1090,SC1091
. "$ENV_FILE"
set +a
erve_require_env DATABASE_URL

mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="$BACKUP_DIR/erve-${TIMESTAMP}.dump"

erve_log "Verifying database connectivity before backup"
LIBPQ_URL="$(erve_libpq_url "$DATABASE_URL")"
psql "$LIBPQ_URL" -tAc "SELECT 1;" >/dev/null || erve_die "Cannot connect to the database to take a backup"

erve_log "Creating backup: $BACKUP_FILE"
pg_dump --format=custom --file="$BACKUP_FILE" "$LIBPQ_URL"

if [ ! -s "$BACKUP_FILE" ]; then
  rm -f "$BACKUP_FILE"
  erve_die "Backup file is empty — refusing to proceed with a migration without a valid backup"
fi

erve_log "Backup created successfully: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# Only runs after the backup above is confirmed non-empty. Deliberately a
# separate script/policy from application release cleanup.
erve_log "Running backup retention cleanup"
"$SCRIPT_DIR/cleanup-backups.sh" "$BACKUP_FILE"
