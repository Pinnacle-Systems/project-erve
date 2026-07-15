#!/usr/bin/env bash
# Removes old database backups beyond the retention window. Deliberately
# separate from application release cleanup (cleanup-releases.sh) — a
# different lifecycle and different safety rules apply (there is no
# "current" symlink concept for backups; instead the backup that was just
# created is the thing that must never be removed).
#
# Usage: cleanup-backups.sh [path to the backup that was just created]
#
# The just-created path, if given, is validated as being inside the backup
# directory and is always retained regardless of the configured retention
# count or its own mtime rank.
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

erve_require_env DEPLOY_ROOT

RETENTION="${ERVE_DB_BACKUP_RETENTION:-10}"
if ! [[ "$RETENTION" =~ ^[0-9]+$ ]] || [ "$RETENTION" -lt 1 ]; then
  erve_log "ERVE_DB_BACKUP_RETENTION='$RETENTION' is invalid or below 1 — normalizing to 1 (the just-created backup is always retained regardless of this setting)"
  RETENTION=1
fi

DEPLOY_ROOT="$(realpath -e "$DEPLOY_ROOT")" || erve_die "DEPLOY_ROOT does not exist: $DEPLOY_ROOT"
BACKUP_DIR="$DEPLOY_ROOT/shared/backups"

JUST_CREATED=""
if [ -n "${1:-}" ]; then
  JUST_CREATED="$(realpath -e "$1")" || erve_die "Just-created backup path does not exist: $1"
  erve_assert_inside_dir "$JUST_CREATED" "$BACKUP_DIR"
fi

if [ ! -d "$BACKUP_DIR" ]; then
  erve_log "No backups directory yet, nothing to clean up"
  exit 0
fi

# Only files directly under shared/backups/ matching the exact convention
# written by backup-database.sh (erve-<UTC compact timestamp>.dump) are
# eligible at all, newest (by mtime) first.
mapfile -t CANDIDATES < <(
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type f -regextype posix-extended \
    -regex '.*/erve-[0-9]{8}T[0-9]{6}Z\.dump' -printf '%T@ %p\n' \
    | sort -rn \
    | awk '{ $1=""; sub(/^ /,""); print }'
)

KEEP=()
REMOVE=()

# Same "total cap, not additive" semantics as cleanup-releases.sh: the
# just-created backup fills one slot first, then the newest remaining
# backups fill the rest up to RETENTION.
if [ -n "$JUST_CREATED" ]; then
  KEEP+=("$JUST_CREATED")
fi

for f in "${CANDIDATES[@]}"; do
  [ "$f" = "$JUST_CREATED" ] && continue
  if [ "${#KEEP[@]}" -lt "$RETENTION" ]; then
    KEEP+=("$f")
  else
    REMOVE+=("$f")
  fi
done

erve_log "Retaining ${#KEEP[@]} backup(s) (retention=$RETENTION), removing ${#REMOVE[@]}"

for f in "${REMOVE[@]}"; do
  erve_assert_inside_dir "$f" "$BACKUP_DIR"
  if [ "$f" = "$JUST_CREATED" ]; then
    erve_log "Refusing to remove the just-created backup: $f"
    continue
  fi
  erve_log "Removing old backup: $f"
  rm -f "$f"
done

erve_log "Backup retention cleanup complete"
erve_log "NOTE: this is on-VPS retention only, not off-server backup storage. See DEPLOYMENT.md for the off-VPS backup and restore-testing requirements."
