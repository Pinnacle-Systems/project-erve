#!/usr/bin/env bash
# Removes old application releases beyond the retention window. Only ever
# deletes directories that are: located directly under the canonical
# releases/ directory, named using the full-Git-SHA pattern, and neither
# the currently active release nor the explicitly recorded previous
# known-good release (see PREVIOUS_MARKER below). Never touches shared/,
# backups, OTA bundles, uploads, or anything outside releases/.
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
# Written by deploy-release.sh right after a new release passes its
# post-activation health check, naming (as a bare SHA) the release that
# was active immediately before this deploy. Without this, the "previous
# known-good" release is only ever inferred as second-newest-by-mtime,
# which a release directory left behind by a failed migration (never
# activated, never moved to .deploy/failed/) could squat ahead of in mtime
# order and cause the real previous known-good to be evicted instead.
PREVIOUS_MARKER="$DEPLOY_ROOT/.deploy/previous-release"

if [ ! -d "$RELEASES_DIR" ]; then
  erve_log "No releases directory yet, nothing to clean up"
  exit 0
fi

# Once releases/ exists, at least one deploy has completed and `current`
# must be a valid, resolvable symlink into it — a missing, broken, or
# escaping `current` means we cannot safely tell what to protect, so fail
# closed rather than silently cleaning up without that protection.
CURRENT_TARGET="$(erve_resolve_release_dir "$CURRENT_LINK" "$RELEASES_DIR")"

PREVIOUS_TARGET=""
if [ -f "$PREVIOUS_MARKER" ]; then
  PREVIOUS_SHA="$(tr -d '[:space:]' < "$PREVIOUS_MARKER")"
  if [ -n "$PREVIOUS_SHA" ]; then
    erve_validate_full_sha "$PREVIOUS_SHA"
    PREVIOUS_CANDIDATE="$RELEASES_DIR/$PREVIOUS_SHA"
    if [ -d "$PREVIOUS_CANDIDATE" ]; then
      erve_assert_inside_dir "$PREVIOUS_CANDIDATE" "$RELEASES_DIR"
      PREVIOUS_TARGET="$(realpath -e "$PREVIOUS_CANDIDATE")"
    else
      erve_log "Recorded previous known-good release no longer exists on disk, nothing extra to protect: $PREVIOUS_CANDIDATE"
    fi
  fi
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
# previous" — current and the previous known-good (if either is set)
# always fill their own RETENTION slots first, then the newest remaining
# releases (by mtime) fill whatever slots are left, up to RETENTION.
KEEP=("$CURRENT_TARGET")
[ -n "$PREVIOUS_TARGET" ] && ! erve_contains "$PREVIOUS_TARGET" "${KEEP[@]}" && KEEP+=("$PREVIOUS_TARGET")
REMOVE=()

for dir in "${CANDIDATES[@]}"; do
  erve_contains "$dir" "${KEEP[@]}" && continue
  if [ "${#KEEP[@]}" -lt "$RETENTION" ]; then
    KEEP+=("$dir")
  else
    REMOVE+=("$dir")
  fi
done

erve_log "Retaining ${#KEEP[@]} release(s) (retention=$RETENTION), removing ${#REMOVE[@]}"

for dir in "${REMOVE[@]}"; do
  erve_assert_inside_dir "$dir" "$RELEASES_DIR"
  if erve_contains "$dir" "$CURRENT_TARGET" "$PREVIOUS_TARGET"; then
    erve_log "Refusing to remove a protected release: $dir"
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
