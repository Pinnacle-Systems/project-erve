#!/usr/bin/env bash
# Removes old application releases beyond the retention window. Only ever
# deletes directories that are: located directly under the canonical
# releases/ directory, named using the full-Git-SHA pattern, and not the
# currently active release. Never touches shared/, backups, OTA bundles,
# uploads, or anything outside releases/.
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

erve_require_env DEPLOY_ROOT

RETENTION="${ERVE_RELEASE_RETENTION:-10}"
# Current + the immediately previous known-good release must always both
# survive, so 2 is the practical floor regardless of what was configured.
if ! [[ "$RETENTION" =~ ^[0-9]+$ ]] || [ "$RETENTION" -lt 2 ]; then
  erve_log "ERVE_RELEASE_RETENTION='$RETENTION' is invalid or below 2 — normalizing to 2 (current + previous known-good must always be retained)"
  RETENTION=2
fi
DEPLOY_ROOT="$(realpath -e "$DEPLOY_ROOT")" || erve_die "DEPLOY_ROOT does not exist: $DEPLOY_ROOT"
RELEASES_DIR="$DEPLOY_ROOT/releases"
CURRENT_LINK="$DEPLOY_ROOT/current"

if [ ! -d "$RELEASES_DIR" ]; then
  erve_log "No releases directory yet, nothing to clean up"
  exit 0
fi

CURRENT_TARGET=""
if [ -L "$CURRENT_LINK" ]; then
  CURRENT_TARGET="$(readlink -f "$CURRENT_LINK")"
fi

STORAGE_BEFORE_KB="$(du -sk "$RELEASES_DIR" | awk '{print $1}')"

# Only directories directly under releases/ whose name is exactly a
# full (40 hex char) Git SHA are eligible at all, newest (by mtime) first.
mapfile -t CANDIDATES < <(
  find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -regextype posix-extended -regex '.*/[0-9a-f]{40}' -printf '%T@ %p\n' \
    | sort -rn \
    | awk '{ $1=""; sub(/^ /,""); print }'
)

# RETENTION is a TOTAL cap, not "RETENTION old releases plus current and
# previous" — current (if set) always fills one of the RETENTION slots
# first, then the newest other releases (by mtime, which is the previous
# known-good release first) fill the remaining slots up to RETENTION.
KEEP=()
REMOVE=()

if [ -n "$CURRENT_TARGET" ]; then
  KEEP+=("$CURRENT_TARGET")
fi

for dir in "${CANDIDATES[@]}"; do
  [ "$dir" = "$CURRENT_TARGET" ] && continue
  if [ "${#KEEP[@]}" -lt "$RETENTION" ]; then
    KEEP+=("$dir")
  else
    REMOVE+=("$dir")
  fi
done

erve_log "Retaining ${#KEEP[@]} release(s) (retention=$RETENTION), removing ${#REMOVE[@]}"

for dir in "${REMOVE[@]}"; do
  erve_assert_inside_dir "$dir" "$RELEASES_DIR"
  if [ "$dir" = "$CURRENT_TARGET" ]; then
    erve_log "Refusing to remove the currently active release: $dir"
    continue
  fi
  erve_log "Removing old release: $dir"
  rm -rf "$dir"
done

STORAGE_AFTER_KB="$(du -sk "$RELEASES_DIR" 2>/dev/null | awk '{print $1}' || echo 0)"
erve_log "Release storage before cleanup: ${STORAGE_BEFORE_KB}KiB, after: ${STORAGE_AFTER_KB}KiB"

# Failed/incomplete releases are a separate, more conservative policy: kept
# briefly for diagnostics (48h) rather than removed immediately.
FAILED_DIR="$DEPLOY_ROOT/.deploy/failed"
if [ -d "$FAILED_DIR" ]; then
  find "$FAILED_DIR" -mindepth 1 -maxdepth 1 -mtime +2 -exec rm -rf {} \;
fi
