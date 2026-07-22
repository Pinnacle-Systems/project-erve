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

# erve_resolve_release_dir LINK PARENT_DIR
# Resolves LINK (e.g. the `current` symlink) to its canonical target and
# fails closed unless that target is a real, existing directory located
# directly inside PARENT_DIR — covering a missing link, a link that isn't
# actually a symlink, a broken symlink (target doesn't exist), and a
# target (relative or absolute) that resolves outside PARENT_DIR. Prints
# the canonical resolved path on success. Callers that skip this in favor
# of ad-hoc `readlink -f` lose these guarantees.
erve_resolve_release_dir() {
  local link="$1" parent_dir="$2" resolved
  [ -L "$link" ] || erve_die "Not a symlink (cannot safely resolve which release is active): $link"
  resolved="$(realpath -e "$link")" || erve_die "Broken symlink, target does not exist: $link"
  erve_assert_inside_dir "$resolved" "$parent_dir"
  printf '%s' "$resolved"
}

# erve_contains NEEDLE [STRAW...]
# True if NEEDLE equals one of the following arguments.
erve_contains() {
  local needle="$1" straw
  shift
  for straw in "$@"; do
    [ "$straw" = "$needle" ] && return 0
  done
  return 1
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

# --- PM2 release binding -----------------------------------------------------
#
# Background: PM2 stores the absolute script path and cwd a named process
# was started with in its own persistent process list, keyed by name.
# `pm2 restart`/`pm2 reload`/`pm2 startOrReload` on an ALREADY-REGISTERED
# name reuse that stored script path/cwd — they do not re-resolve it from
# an ecosystem file passed on the command line, even with `--update-env`
# (which only refreshes environment variables). Historically this repo's
# activation and rollback logic called
# `pm2 startOrReload "$CURRENT_LINK/api/ecosystem.config.cjs" --only erve-api --update-env`
# every time, through the `current` symlink. The very first deploy ever run
# registers erve-api against whatever release `current` happened to resolve
# to at that moment (Node's module loader resolves the symlink before
# `__dirname` is computed inside the ecosystem file). Every subsequent
# deploy/rollback re-points `current` and calls `pm2 startOrReload` again,
# but because erve-api already exists under that name, PM2 does a reload
# in place and keeps serving the script/cwd captured at first registration
# — silently ignoring that `current` now points somewhere else. This is
# exactly how production ended up with `current` pointing at one release
# while PM2 kept running server.js out of a different, already-removed
# release directory (reported "online" the whole time, since from PM2's
# perspective the process object itself never stopped) while the port
# behind it refused connections.
#
# The only operation proven to make PM2 fully replace both the stored
# script path and cwd is deleting the named process and starting fresh —
# see erve_start_api_release below. `pm2 update`/ecosystem "update"
# mechanisms were considered but delete+start is the one PM2 documents as
# always re-resolving every field from scratch, so it is the one used here.

ERVE_APP_NAME="${ERVE_APP_NAME:-erve-api}"

# erve_pm2_query APP_NAME
# Prints exactly one line of 4 tab-separated fields describing PM2's
# current view of APP_NAME, derived from `pm2 jlist` (machine-readable
# JSON) — never from human-formatted `pm2 info`/`pm2 status` output:
#
#   <count of processes named APP_NAME>  <status of the match, if exactly 1>  <pm_exec_path, if exactly 1>  <pm_cwd, if exactly 1>
#
# count != 1 (zero -> absent, more than one -> ambiguous) leaves the other
# three fields empty; callers must treat both as failures rather than
# guessing which of several same-named processes is authoritative. Node is
# used to parse the JSON rather than requiring `jq` on the VPS, since every
# caller of this function already runs under a loaded Node 24 (erve_load_node24).
erve_pm2_query() {
  local app_name="$1" jlist
  jlist="$(pm2 jlist 2>/dev/null)" || { erve_log "erve_pm2_query: 'pm2 jlist' failed to run"; printf '0\t\t\t\n'; return 0; }
  printf '%s' "$jlist" | node -e '
    let apps;
    try {
      apps = JSON.parse(require("fs").readFileSync(0, "utf8"));
      if (!Array.isArray(apps)) throw new Error("not an array");
    } catch (e) {
      process.stdout.write("0\t\t\t\n");
      process.exit(0);
    }
    const name = process.argv[1];
    const matches = apps.filter((a) => a && a.name === name);
    if (matches.length !== 1) {
      process.stdout.write(matches.length + "\t\t\t\n");
      process.exit(0);
    }
    const env = matches[0].pm2_env || {};
    process.stdout.write([1, env.status || "", env.pm_exec_path || "", env.pm_cwd || ""].join("\t") + "\n");
  ' "$app_name"
}

# erve_pm2_process_status APP_NAME
# Prints just the status field (e.g. "online"), or empty when APP_NAME is
# absent or ambiguous (more than one process with that name) — either case
# must be treated by the caller as "not confirmed online".
erve_pm2_process_status() {
  local app_name="$1" count status _script _cwd
  IFS=$'\t' read -r count status _script _cwd < <(erve_pm2_query "$app_name")
  [ "$count" = "1" ] || { printf ''; return 0; }
  printf '%s' "$status"
}

# erve_start_api_release RELEASE_DIR [APP_NAME]
# Binds PM2's APP_NAME (default erve-api) process to RELEASE_DIR by
# deleting any existing process under that name and starting a fresh one
# directly from RELEASE_DIR/api/ecosystem.config.cjs — never through the
# `current` symlink (see the background note above: passing a symlinked
# path lets Node's module resolution silently re-resolve `__dirname` to
# whatever release the symlink happens to point at, which is the exact
# defect this function exists to avoid). RELEASE_DIR must therefore always
# be a canonical, symlink-free release path (e.g. `$RELEASES_DIR/$SHA`, as
# already produced by erve_resolve_release_dir/direct construction in every
# caller) — never $CURRENT_LINK. Preserves every setting already defined in
# the release's own ecosystem.config.cjs (autorestart, max_restarts,
# min_uptime, kill_timeout, listen_timeout, exec_mode, log paths, etc.) —
# this never constructs a competing inline `pm2 start server.js ...`
# command that would silently drop them. Returns 1 (never exits the
# process) on any failure, so callers can decide whether to roll back.
erve_start_api_release() {
  local release_dir="$1" app_name="${2:-$ERVE_APP_NAME}"
  local ecosystem_file="$release_dir/api/ecosystem.config.cjs"

  if [ ! -d "$release_dir" ]; then
    erve_log "erve_start_api_release: release directory does not exist: $release_dir"
    return 1
  fi
  if [ ! -f "$release_dir/api/server.js" ]; then
    erve_log "erve_start_api_release: release is missing api/server.js: $release_dir"
    return 1
  fi
  if [ ! -f "$ecosystem_file" ]; then
    erve_log "erve_start_api_release: release is missing api/ecosystem.config.cjs: $release_dir"
    return 1
  fi

  erve_log "Deleting any existing PM2 process named '$app_name' so its previously stored script path/cwd cannot be silently reused"
  pm2 delete "$app_name" >/dev/null 2>&1 || true

  erve_log "Starting PM2 process '$app_name' directly against $release_dir/api"
  if ! ( cd "$release_dir/api" && pm2 start ecosystem.config.cjs --only "$app_name" --update-env ); then
    erve_log "erve_start_api_release: 'pm2 start' failed for $release_dir"
    return 1
  fi
  return 0
}

# erve_assert_pm2_release RELEASE_DIR [APP_NAME]
# Fails closed (returns 1, logging a full expected-vs-actual diagnostic)
# unless PM2 reports exactly one process named APP_NAME and its stored
# pm_exec_path/pm_cwd exactly equal RELEASE_DIR/api/server.js and
# RELEASE_DIR/api. Covers: process absent, process ambiguous (duplicate
# name), empty script/cwd reported by PM2, RELEASE_DIR missing on disk,
# server.js missing, and a plain script/cwd mismatch. Must be called (and
# must pass) before any application-level health check is attempted —
# a passing curl request proves nothing about which release actually
# answered it if PM2 itself is not confirmed to be running the expected
# one.
erve_assert_pm2_release() {
  local release_dir="$1" app_name="${2:-$ERVE_APP_NAME}"
  local expected_script="$release_dir/api/server.js"
  local expected_cwd="$release_dir/api"
  local count status actual_script actual_cwd

  if [ ! -d "$release_dir" ]; then
    erve_log "PM2 target assertion FAILED: expected release directory does not exist: $release_dir"
    return 1
  fi
  if [ ! -f "$expected_script" ]; then
    erve_log "PM2 target assertion FAILED: expected release is missing server.js: $expected_script"
    return 1
  fi

  IFS=$'\t' read -r count status actual_script actual_cwd < <(erve_pm2_query "$app_name")

  if [ "$count" = "0" ]; then
    erve_log "PM2 target assertion FAILED: no PM2 process named '$app_name' is running"
    erve_log "  Expected release: $release_dir"
    return 1
  fi
  if [ "$count" != "1" ]; then
    erve_log "PM2 target assertion FAILED: $count PM2 processes named '$app_name' exist — refusing to pick one arbitrarily"
    erve_log "  Expected release: $release_dir"
    return 1
  fi
  if [ -z "$actual_script" ] || [ -z "$actual_cwd" ]; then
    erve_log "PM2 target assertion FAILED: PM2 reported an empty script path or cwd for '$app_name'"
    erve_log "  Expected script path: $expected_script"
    erve_log "  Actual script path:   ${actual_script:-<empty>}"
    erve_log "  Expected cwd:         $expected_cwd"
    erve_log "  Actual cwd:           ${actual_cwd:-<empty>}"
    erve_log "  Expected release:     $release_dir"
    return 1
  fi

  # Canonicalize both sides before comparing. `expected_*` is built by
  # plain string concatenation of $release_dir (every current caller
  # already passes a realpath'd, symlink-free directory, but this
  # function's contract shouldn't silently depend on that); `actual_*`
  # comes verbatim from PM2's own report and could in principle carry a
  # trailing slash or other cosmetic difference.
  #
  # GNU `readlink -f` only tolerates the *final* path component being
  # missing — it fails closed (empty stdout, exit 1) the moment any
  # earlier component doesn't exist, which is exactly the stale/deleted
  # release case (the entire releases/<old-sha>/ directory can be gone).
  # A bare `var="$(readlink -f ...)"` assignment is NOT protected from
  # `set -e` the way a combined `local var="$(...)"` would accidentally be
  # (that combined form only masks the substitution's exit status, which
  # is exactly the SC2155 pitfall avoided above by declaring `local`
  # separately) — so a failed canonicalization here must be caught
  # explicitly, or it would abort the whole deploy/rollback script instead
  # of letting this function report a clean mismatch. Falling back to the
  # raw, uncanonicalized value on failure is safe: it still can't equal a
  # canonicalized `expected_*` value that starts from a path known to
  # exist, so the mismatch is still detected and reported correctly.
  local expected_script_canon expected_cwd_canon actual_script_canon actual_cwd_canon
  expected_script_canon="$(readlink -f -- "$expected_script" 2>/dev/null || printf '%s' "$expected_script")"
  expected_cwd_canon="$(readlink -f -- "$expected_cwd" 2>/dev/null || printf '%s' "$expected_cwd")"
  actual_script_canon="$(readlink -f -- "$actual_script" 2>/dev/null || printf '%s' "$actual_script")"
  actual_cwd_canon="$(readlink -f -- "$actual_cwd" 2>/dev/null || printf '%s' "$actual_cwd")"

  if [ "$actual_script_canon" != "$expected_script_canon" ] || [ "$actual_cwd_canon" != "$expected_cwd_canon" ]; then
    erve_log "PM2 target assertion FAILED: PM2 is running a different release than expected"
    erve_log "  Expected script path: $expected_script (canonical: $expected_script_canon)"
    erve_log "  Actual script path:   $actual_script (canonical: $actual_script_canon)"
    erve_log "  Expected cwd:         $expected_cwd (canonical: $expected_cwd_canon)"
    erve_log "  Actual cwd:           $actual_cwd (canonical: $actual_cwd_canon)"
    erve_log "  Expected release:     $release_dir"
    return 1
  fi

  erve_log "PM2 target assertion passed: '$app_name' -> $release_dir"
  return 0
}

# erve_activate_pm2_release RELEASE_DIR APP_PORT [APP_NAME]
# The one shared function responsible for binding PM2 to a specific
# release and proving it worked, used identically to activate a newly
# deployed release and to restore a previous release after a failed health
# check — there is deliberately no separate/duplicated rollback-restart
# code path. Order: start (delete+start against RELEASE_DIR) -> assert
# (PM2 actually resolved to RELEASE_DIR) -> local health check
# (verify-release.sh, which itself re-checks PM2 liveness on every retry
# and fails fast with logs if the process disappears mid-loop). Never
# calls `pm2 save` — callers must only do that after this returns success,
# so a failed release's PM2 definition is never persisted.
erve_activate_pm2_release() {
  local release_dir="$1" app_port="$2" app_name="${3:-$ERVE_APP_NAME}"
  local lib_dir script_dir
  lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  script_dir="$(cd "$lib_dir/.." && pwd)"

  if ! erve_start_api_release "$release_dir" "$app_name"; then
    return 1
  fi
  if ! erve_assert_pm2_release "$release_dir" "$app_name"; then
    return 1
  fi

  erve_log "Running local health checks against $release_dir"
  if ! "$script_dir/verify-release.sh" local "$app_port" "$app_name"; then
    return 1
  fi
  return 0
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
