#!/usr/bin/env bash
# Shared helpers sourced by every script under scripts/deployment/. Not
# meant to be executed directly.
#
# Every script that sources this file is expected to already have run
# `set -Eeuo pipefail` itself (bash options are not inherited via `source`
# in a way that survives a script forgetting to set them, so each entry
# point sets its own).

# --- logging -----------------------------------------------------------

erve_log() {
  printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
}

erve_die() {
  erve_log "ERROR: $*"
  exit 1
}

# --- environment validation ---------------------------------------------

# erve_require_env VAR1 VAR2 ...
# Fails if any named variable is unset or empty. Never prints values.
erve_require_env() {
  local name missing=()
  for name in "$@"; do
    if [ -z "${!name:-}" ]; then
      missing+=("$name")
    fi
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    erve_die "Required environment variable(s) not set: ${missing[*]}"
  fi
}

# --- Git SHA validation ---------------------------------------------------

# erve_validate_full_sha SHA
# A full (40 hex char) Git commit SHA only — rejects short SHAs, refs,
# branch names, and anything that could be a path traversal payload once
# used to build a directory name.
erve_validate_full_sha() {
  local sha="$1"
  if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
    erve_die "Not a valid full Git commit SHA: '$sha'"
  fi
}

# --- canonical path safety -------------------------------------------------

# erve_assert_inside_dir CANDIDATE PARENT
# Fails unless the canonical (symlink-resolved) form of CANDIDATE is
# actually located inside the canonical form of PARENT. Used before any
# deletion so a crafted/unexpected path can never cause a delete outside
# the releases directory.
erve_assert_inside_dir() {
  local candidate="$1" parent="$2" real_candidate real_parent
  real_candidate="$(realpath -e "$candidate")" || erve_die "Path does not exist: $candidate"
  real_parent="$(realpath -e "$parent")" || erve_die "Parent path does not exist: $parent"
  case "$real_candidate" in
    "$real_parent"/*) ;;
    *) erve_die "Refusing to operate outside $real_parent: $real_candidate" ;;
  esac
}

# --- NVM / Node 24 ----------------------------------------------------------

# erve_load_node24
# Explicitly loads NVM (never assumed to be pre-loaded in a non-interactive
# SSH session) and activates Node 24, failing closed if the resulting major
# version is not 24 rather than silently falling back to CloudPanel's
# Node 22 install.
erve_load_node24() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
  else
    erve_die "NVM is not installed for this user (expected $NVM_DIR/nvm.sh)"
  fi

  nvm use 24 >&2 || erve_die "Failed to activate Node.js 24 via nvm"

  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$major" != "24" ]; then
    erve_die "Active Node major version is '$major', expected 24 (refusing to fall back to another runtime)"
  fi
}

# --- deployment lock ---------------------------------------------------------

# erve_acquire_lock LOCK_DIR
# Directory-creation-based lock (mkdir is atomic on POSIX filesystems, so
# this needs no extra `flock` dependency). Registers a trap that releases
# the lock on script exit; callers must not overwrite the EXIT trap after
# calling this without chaining to erve_release_lock themselves.
ERVE_LOCK_PATH=""

erve_acquire_lock() {
  local lock_dir="$1" attempts=0
  ERVE_LOCK_PATH="$lock_dir"
  while ! mkdir "$lock_dir" 2>/dev/null; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 30 ]; then
      erve_die "Could not acquire deployment lock at $lock_dir after ${attempts} attempts (another deployment in progress?)"
    fi
    erve_log "Deployment lock at $lock_dir is held, waiting..."
    sleep 2
  done
  trap 'erve_release_lock' EXIT
  erve_log "Acquired deployment lock: $lock_dir"
}

erve_release_lock() {
  if [ -n "$ERVE_LOCK_PATH" ] && [ -d "$ERVE_LOCK_PATH" ]; then
    rmdir "$ERVE_LOCK_PATH" 2>/dev/null || true
    erve_log "Released deployment lock: $ERVE_LOCK_PATH"
  fi
}

# --- Postgres URL handling -----------------------------------------------

# erve_libpq_url DATABASE_URL
# Strips the `schema` query parameter from a Postgres connection URL.
# `schema` is a Prisma-only extension (used by the app and by `prisma
# migrate deploy`) that libpq does not recognize — passing it straight
# through to psql/pg_dump fails with "invalid URI query parameter:
# schema". Any other query parameters (e.g. sslmode) are left untouched.
erve_libpq_url() {
  local url="$1" base="${1%%\?*}" query part joined=""
  query="${url#*\?}"
  [ "$query" = "$url" ] && { printf '%s' "$url"; return; }
  local IFS='&'
  for part in $query; do
    case "$part" in
      schema=*) ;;
      *) joined="${joined:+$joined&}$part" ;;
    esac
  done
  if [ -n "$joined" ]; then
    printf '%s?%s' "$base" "$joined"
  else
    printf '%s' "$base"
  fi
}

# --- disk space preflight ----------------------------------------------------

# erve_check_disk_space TARGET_DIR ARTIFACT_SIZE_BYTES
# Fails unless available space under TARGET_DIR is at least
# (3 * artifact size) + 1 GiB, to cover the incoming archive, the extracted
# release, and a safety margin.
erve_check_disk_space() {
  local target_dir="$1" artifact_bytes="$2" available_kb required_kb
  available_kb="$(df -Pk "$target_dir" | awk 'NR==2 {print $4}')"
  required_kb=$(( (artifact_bytes * 3 / 1024) + (1024 * 1024) ))
  erve_log "Disk space check: available=${available_kb}KiB required=${required_kb}KiB"
  if [ "$available_kb" -lt "$required_kb" ]; then
    erve_die "Insufficient disk space under $target_dir: ${available_kb}KiB available, ${required_kb}KiB required"
  fi
}
