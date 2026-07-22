#!/usr/bin/env bash
# Regression coverage for the PM2 release-binding fix in lib/common.sh
# (erve_start_api_release, erve_assert_pm2_release, erve_activate_pm2_release)
# and verify-release.sh's PM2-aware retry loop.
#
# Background: PM2 stores the absolute script path/cwd a named process was
# started with, and `pm2 restart`/`pm2 reload`/`pm2 startOrReload` against
# an already-registered name do not reliably re-resolve those fields (only
# `--update-env` env vars get refreshed) — this repo's deploy/rollback
# scripts used to call `pm2 startOrReload "$CURRENT_LINK/api/ecosystem..."`
# every time, so once erve-api was first registered, later deploys/
# rollbacks that re-pointed `current` silently kept reloading whatever
# release was targeted at first registration. Production observed exactly
# this: `current` pointed at one release while PM2 kept serving
# server.js out of a different, already-removed release directory,
# reporting "online" throughout while the port behind it refused
# connections.
#
# No real PM2 daemon is used anywhere in this file — every `pm2` call goes
# through fixtures/fake-pm2/pm2, a test double that tracks process state in
# a plain JSON file and (for "healthy" releases) actually spawns a tiny
# real Node HTTP server so the genuine `verify-release.sh` can hit it with
# real `curl` requests. fake-pm2's `start` subcommand genuinely
# `require()`s the ecosystem file via Node, exactly like real PM2 does
# internally, so it reproduces real Node module-resolution semantics
# (notably: resolving symlinks before computing `__dirname`).
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$DEPLOYMENT_DIR/../.." && pwd)"
FAKE_PM2_DIR="$SCRIPT_DIR/fixtures/fake-pm2"
REAL_ECOSYSTEM="$REPO_ROOT/deployment/pm2/ecosystem.config.cjs"

# shellcheck source=../lib/common.sh
source "$DEPLOYMENT_DIR/lib/common.sh"

[ -x "$FAKE_PM2_DIR/pm2" ] || chmod +x "$FAKE_PM2_DIR/pm2"
export PATH="$FAKE_PM2_DIR:$PATH"

# Keep the fixture-based tests fast: verify-release.sh's real defaults
# (10 attempts, 2s apart) are for production, not this suite.
export ERVE_HEALTH_CHECK_ATTEMPTS=3
export ERVE_HEALTH_CHECK_SLEEP_SECONDS=1

FAILED=0
# Randomized base, not a fixed constant: avoids colliding with a port a
# stray/leaked process from an earlier interrupted run of this same suite
# might still be holding open (each run of this script starts a fresh
# TEST_PORT_COUNTER, so a fixed base would keep hitting the same port).
TEST_PORT_COUNTER=$((20000 + (RANDOM % 20000)))

fail() {
  echo "FAIL: $1" >&2
  FAILED=1
}

# --- fixture helpers ---------------------------------------------------------

make_fixture_root() {
  local root
  root="$(mktemp -d)"
  mkdir -p "$root/releases"
  echo "$root"
}

# make_release ROOT SHA
# Builds $ROOT/releases/$SHA/api with a real server.js placeholder and an
# exact copy of the repository's actual production ecosystem.config.cjs
# (the same file package-production.sh copies into every real release),
# so fake-pm2's require()-based parsing exercises the real app name/script.
make_release() {
  local root="$1" sha="$2"
  mkdir -p "$root/releases/$sha/api" "$root/releases/$sha/web"
  printf 'require("http").createServer(function(_q,r){r.writeHead(200);r.end("ok");}).listen(process.env.PORT||0);\n' > "$root/releases/$sha/api/server.js"
  cp "$REAL_ECOSYSTEM" "$root/releases/$sha/api/ecosystem.config.cjs"
  : > "$root/releases/$sha/web/index.html"
}

set_behavior() {
  local root="$1" sha="$2" behavior="$3"
  printf '%s' "$behavior" > "$root/releases/$sha/.fake-pm2-behavior"
}

fake_sha() {
  printf '%040d' "$1"
}

# next_port: distinct port per test so leftover listeners from a failed
# test/cleanup can't leak into the next one's assertions.
next_port() {
  TEST_PORT_COUNTER=$((TEST_PORT_COUNTER + 1))
  echo "$TEST_PORT_COUNTER"
}

# reset_fake_pm2: fresh state/log files and a fresh health port, exported
# for both this process and every child process (verify-release.sh, the
# fake pm2 script, and the real Node HTTP servers it spawns) to share.
reset_fake_pm2() {
  export FAKE_PM2_STATE; FAKE_PM2_STATE="$(mktemp)"
  echo '[]' > "$FAKE_PM2_STATE"
  export FAKE_PM2_LOG; FAKE_PM2_LOG="$(mktemp)"
  : > "$FAKE_PM2_LOG"
  export FAKE_HEALTH_PORT; FAKE_HEALTH_PORT="$(next_port)"
}

# cleanup_fake_pm2: kills any process the fake pm2 double is still tracking
# (real backgrounded Node HTTP servers for "healthy" releases) and removes
# the scratch state/log files.
cleanup_fake_pm2() {
  pm2 delete "$ERVE_APP_NAME" >/dev/null 2>&1 || true
  rm -f "$FAKE_PM2_STATE" "$FAKE_PM2_LOG"
}

pm2_query_field() {
  local app_name="$1" field_index="$2"
  erve_pm2_query "$app_name" | cut -f"$field_index"
}

# norm PATH
# On MSYS/Git-Bash (Windows dev boxes only — never the Linux VPS/CI this
# actually deploys to), the fake pm2 double's `node` is a native win32
# build that prints backslash-separated Windows paths, while every path
# bash constructs is POSIX-style. That mismatch is a local-verification
# artifact of mixing an MSYS shell with a native Windows Node binary, not a
# defect in erve_start_api_release/erve_assert_pm2_release themselves —
# both sides of every comparison below are normalized through `cygpath`
# (a no-op passthrough wherever cygpath doesn't exist, i.e. real Linux).
norm() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -u -- "$1"
  else
    printf '%s' "$1"
  fi
}

# --- erve_start_api_release ---------------------------------------------------

test_start_api_release_binds_script_and_cwd() {
  local root; root="$(make_fixture_root)"
  local sha; sha="$(fake_sha 1)"
  make_release "$root" "$sha"
  set_behavior "$root" "$sha" healthy
  reset_fake_pm2

  local release_dir="$root/releases/$sha"
  if ! erve_start_api_release "$release_dir" >/dev/null 2>&1; then
    fail "start_api_release_binds_script_and_cwd: erve_start_api_release failed"
  fi

  local script cwd
  script="$(pm2_query_field "$ERVE_APP_NAME" 3)"
  cwd="$(pm2_query_field "$ERVE_APP_NAME" 4)"
  [ "$(norm "$script")" = "$(norm "$release_dir/api/server.js")" ] || fail "start_api_release_binds_script_and_cwd: expected script $release_dir/api/server.js, got $script"
  [ "$(norm "$cwd")" = "$(norm "$release_dir/api")" ] || fail "start_api_release_binds_script_and_cwd: expected cwd $release_dir/api, got $cwd"

  cleanup_fake_pm2
  rm -rf "$root"
}

# --- erve_assert_pm2_release ---------------------------------------------------

test_assert_pm2_release_passes_when_matching() {
  local root; root="$(make_fixture_root)"
  local sha; sha="$(fake_sha 1)"
  make_release "$root" "$sha"
  set_behavior "$root" "$sha" healthy
  reset_fake_pm2

  local release_dir="$root/releases/$sha"
  erve_start_api_release "$release_dir" >/dev/null 2>&1
  erve_assert_pm2_release "$release_dir" >/dev/null 2>&1 \
    || fail "assert_pm2_release_passes_when_matching: assertion incorrectly failed for a correctly bound release"

  cleanup_fake_pm2
  rm -rf "$root"
}

# --- scenario 6: missing PM2 process ------------------------------------------
test_assert_pm2_release_fails_when_process_absent() {
  local root; root="$(make_fixture_root)"
  local sha; sha="$(fake_sha 1)"
  make_release "$root" "$sha"
  reset_fake_pm2
  # Deliberately never start anything — erve-api is absent.

  if erve_assert_pm2_release "$root/releases/$sha" >/dev/null 2>&1; then
    fail "assert_pm2_release_fails_when_process_absent: assertion should fail closed when the PM2 process is absent"
  fi

  cleanup_fake_pm2
  rm -rf "$root"
}

test_assert_pm2_release_fails_when_release_dir_missing() {
  reset_fake_pm2
  if erve_assert_pm2_release "/nonexistent/release/dir-$$" >/dev/null 2>&1; then
    fail "assert_pm2_release_fails_when_release_dir_missing: assertion should fail closed for a nonexistent release directory"
  fi
  cleanup_fake_pm2
}

test_assert_pm2_release_fails_when_server_js_missing() {
  local root; root="$(make_fixture_root)"
  local sha; sha="$(fake_sha 1)"
  mkdir -p "$root/releases/$sha/api"
  reset_fake_pm2
  if erve_assert_pm2_release "$root/releases/$sha" >/dev/null 2>&1; then
    fail "assert_pm2_release_fails_when_server_js_missing: assertion should fail closed when server.js is missing"
  fi
  cleanup_fake_pm2
  rm -rf "$root"
}

# --- scenario 5: PM2 mismatch fails closed (curl would pass; PM2 metadata
# does not match) -------------------------------------------------------------
test_assert_pm2_release_fails_on_mismatch() {
  local root; root="$(make_fixture_root)"
  local sha_a; sha_a="$(fake_sha 1)"
  local sha_b; sha_b="$(fake_sha 2)"
  make_release "$root" "$sha_a"
  make_release "$root" "$sha_b"
  set_behavior "$root" "$sha_a" healthy
  reset_fake_pm2

  # PM2 is genuinely, healthily bound to release A ...
  erve_start_api_release "$root/releases/$sha_a" >/dev/null 2>&1

  # ... but the deployment logic expects release B. A curl against A's real
  # health server would succeed; the assertion must still fail, and it must
  # be checked before any such curl is ever attempted (see
  # test_activate_pm2_release_asserts_before_health_check_in_source below).
  if erve_assert_pm2_release "$root/releases/$sha_b" >/dev/null 2>&1; then
    fail "assert_pm2_release_fails_on_mismatch: assertion should fail when PM2 is healthily bound to a different release than expected"
  fi

  cleanup_fake_pm2
  rm -rf "$root"
}

# --- scenario 7: duplicate PM2 processes --------------------------------------
test_assert_pm2_release_fails_on_duplicate_process_name() {
  local root; root="$(make_fixture_root)"
  local sha; sha="$(fake_sha 1)"
  make_release "$root" "$sha"
  reset_fake_pm2
  local release_dir="$root/releases/$sha"

  # Written directly with printf (no node argv involved) deliberately —
  # see merge_pm2_entry's comment in fixtures/fake-pm2/pm2 on why release
  # paths must never be shuttled through another process's argv/env.
  local entry
  entry="{\"name\":\"$ERVE_APP_NAME\",\"pid\":0,\"pm2_env\":{\"status\":\"online\",\"pm_exec_path\":\"$release_dir/api/server.js\",\"pm_cwd\":\"$release_dir/api\"}}"
  printf '[%s,%s]' "$entry" "$entry" > "$FAKE_PM2_STATE"

  if erve_assert_pm2_release "$release_dir" >/dev/null 2>&1; then
    fail "assert_pm2_release_fails_on_duplicate_process_name: assertion should refuse to pick one of several same-named processes"
  fi

  cleanup_fake_pm2
  rm -rf "$root"
}

test_assert_pm2_release_fails_on_empty_metadata() {
  local root; root="$(make_fixture_root)"
  local sha; sha="$(fake_sha 1)"
  make_release "$root" "$sha"
  reset_fake_pm2
  local release_dir="$root/releases/$sha"

  printf '[{"name":"%s","pid":0,"pm2_env":{"status":"online","pm_exec_path":"","pm_cwd":""}}]' "$ERVE_APP_NAME" > "$FAKE_PM2_STATE"

  if erve_assert_pm2_release "$release_dir" >/dev/null 2>&1; then
    fail "assert_pm2_release_fails_on_empty_metadata: assertion should fail closed when PM2 reports an empty script path/cwd"
  fi

  cleanup_fake_pm2
  rm -rf "$root"
}

# --- scenario 3: stale PM2 definition (current would point at release A;
# PM2 is bound to a deleted/nonexistent release B) is detected and repaired
# by the same start function used for every activation/rollback -------------
test_start_api_release_repairs_stale_definition() {
  local root; root="$(make_fixture_root)"
  local sha_a; sha_a="$(fake_sha 1)"
  make_release "$root" "$sha_a"
  set_behavior "$root" "$sha_a" healthy
  reset_fake_pm2

  # Seed PM2 as already pointing at a release directory that no longer
  # exists on disk at all (simulating cleanup-releases.sh having removed
  # it, or a failed release moved to .deploy/failed/).
  local stale_dir
  stale_dir="$root/releases/$(fake_sha 99)"
  printf '[{"name":"%s","pid":0,"pm2_env":{"status":"online","pm_exec_path":"%s","pm_cwd":"%s"}}]' \
    "$ERVE_APP_NAME" "$stale_dir/api/server.js" "$stale_dir/api" > "$FAKE_PM2_STATE"

  # Confirm the assertion correctly detects the mismatch before repair.
  if erve_assert_pm2_release "$root/releases/$sha_a" >/dev/null 2>&1; then
    fail "start_api_release_repairs_stale_definition: assertion should have detected the stale binding before repair"
  fi

  # The same shared function used for every activation repairs it.
  erve_start_api_release "$root/releases/$sha_a" >/dev/null 2>&1
  erve_assert_pm2_release "$root/releases/$sha_a" >/dev/null 2>&1 \
    || fail "start_api_release_repairs_stale_definition: erve_start_api_release did not repair the stale PM2 binding"

  cleanup_fake_pm2
  rm -rf "$root"
}

# --- scenario 1: successful activation ----------------------------------------
test_activate_pm2_release_success() {
  local root; root="$(make_fixture_root)"
  local sha_a; sha_a="$(fake_sha 1)"
  local sha_b; sha_b="$(fake_sha 2)"
  make_release "$root" "$sha_a"
  make_release "$root" "$sha_b"
  set_behavior "$root" "$sha_a" healthy
  reset_fake_pm2

  # current -> release-A, PM2 -> release-A (the starting state)
  erve_start_api_release "$root/releases/$sha_a" >/dev/null 2>&1

  # Activate release-B (also healthy, on the same fake health port since
  # only one release is ever "current" at a time).
  set_behavior "$root" "$sha_b" healthy
  if ! erve_activate_pm2_release "$root/releases/$sha_b" "$FAKE_HEALTH_PORT" >/dev/null 2>&1; then
    fail "activate_pm2_release_success: activation of a healthy release should succeed"
  fi

  local script cwd
  script="$(pm2_query_field "$ERVE_APP_NAME" 3)"
  cwd="$(pm2_query_field "$ERVE_APP_NAME" 4)"
  [ "$(norm "$script")" = "$(norm "$root/releases/$sha_b/api/server.js")" ] || fail "activate_pm2_release_success: expected PM2 script path to point at release-B, got $script"
  [ "$(norm "$cwd")" = "$(norm "$root/releases/$sha_b/api")" ] || fail "activate_pm2_release_success: expected PM2 cwd to point at release-B, got $cwd"

  cleanup_fake_pm2
  rm -rf "$root"
}

# --- scenario 2: failed activation with rollback ------------------------------
test_activate_pm2_release_failure_then_rollback() {
  local root; root="$(make_fixture_root)"
  local sha_a; sha_a="$(fake_sha 1)"
  local sha_b; sha_b="$(fake_sha 2)"
  make_release "$root" "$sha_a"
  make_release "$root" "$sha_b"
  set_behavior "$root" "$sha_a" healthy
  reset_fake_pm2

  # release-A healthy and active.
  erve_start_api_release "$root/releases/$sha_a" >/dev/null 2>&1
  erve_assert_pm2_release "$root/releases/$sha_a" >/dev/null 2>&1 \
    || fail "activate_pm2_release_failure_then_rollback: release-A should be healthy and active before the failed activation attempt"

  # release-B fails health (never binds the port).
  set_behavior "$root" "$sha_b" down
  if erve_activate_pm2_release "$root/releases/$sha_b" "$FAKE_HEALTH_PORT" >/dev/null 2>&1; then
    fail "activate_pm2_release_failure_then_rollback: activation of an unhealthy release should fail"
  fi

  # Deployment scripts restore `current` to release-A themselves and then
  # call the same shared function again to rebind + verify + health-check.
  if ! erve_activate_pm2_release "$root/releases/$sha_a" "$FAKE_HEALTH_PORT" >/dev/null 2>&1; then
    fail "activate_pm2_release_failure_then_rollback: rollback re-activation of release-A should succeed"
  fi
  erve_assert_pm2_release "$root/releases/$sha_a" >/dev/null 2>&1 \
    || fail "activate_pm2_release_failure_then_rollback: PM2 should be bound to release-A again after rollback"

  cleanup_fake_pm2
  rm -rf "$root"
}

# --- verify-release.sh: PM2 status "online" alone is not sufficient; a
# process that never actually answers exhausts the retry budget and fails --
test_verify_release_down_status_exhausts_retries_then_fails() {
  local root; root="$(make_fixture_root)"
  local sha; sha="$(fake_sha 1)"
  make_release "$root" "$sha"
  set_behavior "$root" "$sha" down
  reset_fake_pm2

  erve_start_api_release "$root/releases/$sha" >/dev/null 2>&1

  if "$DEPLOYMENT_DIR/verify-release.sh" local "$FAKE_HEALTH_PORT" "$ERVE_APP_NAME" >/dev/null 2>&1; then
    fail "verify_release_down_status_exhausts_retries_then_fails: health check should fail when nothing answers the port, even though PM2 reports 'online'"
  fi
  if grep -q 'pm2 logs' "$FAKE_PM2_LOG"; then
    fail "verify_release_down_status_exhausts_retries_then_fails: should not have taken the fail-fast/log-dump path while PM2 still reported 'online' throughout"
  fi

  cleanup_fake_pm2
  rm -rf "$root"
}

# --- verify-release.sh: a process that stops being "online" partway through
# the retry loop fails fast and dumps PM2 logs, rather than exhausting curl
# retries ----------------------------------------------------------------------
test_verify_release_fails_fast_and_dumps_logs_when_process_not_online() {
  local root; root="$(make_fixture_root)"
  local sha; sha="$(fake_sha 1)"
  make_release "$root" "$sha"
  set_behavior "$root" "$sha" crashed
  reset_fake_pm2

  erve_start_api_release "$root/releases/$sha" >/dev/null 2>&1

  if "$DEPLOYMENT_DIR/verify-release.sh" local "$FAKE_HEALTH_PORT" "$ERVE_APP_NAME" >/dev/null 2>&1; then
    fail "verify_release_fails_fast_and_dumps_logs_when_process_not_online: health check should fail when PM2 does not report 'online'"
  fi
  grep -q 'pm2 logs erve-api' "$FAKE_PM2_LOG" \
    || fail "verify_release_fails_fast_and_dumps_logs_when_process_not_online: expected 'pm2 logs' to have been consulted when the process was not online"

  cleanup_fake_pm2
  rm -rf "$root"
}

# --- contract tests against the real scripts' source (no execution;
# proves the shared functions are actually wired in, in the right order,
# and the old broken mechanism is fully gone) ----------------------------------

test_no_script_uses_pm2_restart_reload_or_startOrReload() {
  local f
  for f in "$DEPLOYMENT_DIR/deploy-release.sh" "$DEPLOYMENT_DIR/rollback-release.sh"; do
    if grep -Eq 'pm2 (restart|reload|startOrReload)' "$f"; then
      fail "no_script_uses_pm2_restart_reload_or_startOrReload: $f still calls pm2 restart/reload/startOrReload directly instead of erve_activate_pm2_release"
    fi
  done
}

# --- scenario 4: symlink switch alone is insufficient — both the initial
# activation and every rollback path must go through the one shared
# erve_activate_pm2_release function, never a bare pm2 call, and never
# through $CURRENT_LINK (the exact path that caused the original bug) -------
test_activation_and_rollback_paths_use_shared_function_not_current_link() {
  local f count
  for f in "$DEPLOYMENT_DIR/deploy-release.sh" "$DEPLOYMENT_DIR/rollback-release.sh"; do
    count="$(grep -c 'erve_activate_pm2_release' "$f" || true)"
    [ "$count" -ge 2 ] || fail "activation_and_rollback_paths_use_shared_function_not_current_link: $f should call erve_activate_pm2_release at least twice (activate + rollback/restore), found $count"

    # Single-quoted deliberately: searches the target file's source text
    # for the literal string "$CURRENT_LINK", not an expansion in this script.
    # shellcheck disable=SC2016
    if grep -q 'erve_activate_pm2_release "\$CURRENT_LINK' "$f" || grep -q 'erve_start_api_release "\$CURRENT_LINK' "$f"; then
      fail "activation_and_rollback_paths_use_shared_function_not_current_link: $f binds PM2 through \$CURRENT_LINK — this is exactly the bug (Node resolves the symlink at require() time, silently baking in whichever release happened to be current at first registration)"
    fi
  done
}

# --- scenario 8: pm2 save cannot run before a successful health check --------
test_pm2_save_never_precedes_activation_attempt() {
  local f first_activate_line first_save_line
  for f in "$DEPLOYMENT_DIR/deploy-release.sh" "$DEPLOYMENT_DIR/rollback-release.sh"; do
    first_activate_line="$(grep -n 'erve_activate_pm2_release' "$f" | head -1 | cut -d: -f1)"
    first_save_line="$(grep -n '^\s*pm2 save\s*$' "$f" | head -1 | cut -d: -f1)"
    if [ -z "$first_activate_line" ] || [ -z "$first_save_line" ]; then
      fail "pm2_save_never_precedes_activation_attempt: could not locate both an erve_activate_pm2_release call and a 'pm2 save' line in $f"
      continue
    fi
    [ "$first_save_line" -gt "$first_activate_line" ] \
      || fail "pm2_save_never_precedes_activation_attempt: $f calls 'pm2 save' (line $first_save_line) before its first erve_activate_pm2_release attempt (line $first_activate_line)"
  done
}

# --- erve_activate_pm2_release's own internal ordering: the PM2 target
# assertion must run before verify-release.sh is ever invoked (source-level
# proof backing test_assert_pm2_release_fails_on_mismatch above) ------------
test_activate_pm2_release_asserts_before_health_check_in_source() {
  local common_sh="$DEPLOYMENT_DIR/lib/common.sh"
  local assert_line health_check_line
  # Single-quoted deliberately: searches lib/common.sh's source text for
  # the literal call, not an expansion in this script.
  # shellcheck disable=SC2016
  assert_line="$(grep -n 'erve_assert_pm2_release "\$release_dir" "\$app_name"' "$common_sh" | tail -1 | cut -d: -f1)"
  health_check_line="$(grep -n 'verify-release.sh" local' "$common_sh" | head -1 | cut -d: -f1)"
  if [ -z "$assert_line" ] || [ -z "$health_check_line" ]; then
    fail "activate_pm2_release_asserts_before_health_check_in_source: could not locate both the assertion call and the health check call in lib/common.sh"
    return
  fi
  [ "$health_check_line" -gt "$assert_line" ] \
    || fail "activate_pm2_release_asserts_before_health_check_in_source: erve_activate_pm2_release must assert the PM2 target before ever invoking verify-release.sh"
}

test_start_api_release_binds_script_and_cwd
test_assert_pm2_release_passes_when_matching
test_assert_pm2_release_fails_when_process_absent
test_assert_pm2_release_fails_when_release_dir_missing
test_assert_pm2_release_fails_when_server_js_missing
test_assert_pm2_release_fails_on_mismatch
test_assert_pm2_release_fails_on_duplicate_process_name
test_assert_pm2_release_fails_on_empty_metadata
test_start_api_release_repairs_stale_definition
test_activate_pm2_release_success
test_activate_pm2_release_failure_then_rollback
test_verify_release_down_status_exhausts_retries_then_fails
test_verify_release_fails_fast_and_dumps_logs_when_process_not_online
test_no_script_uses_pm2_restart_reload_or_startOrReload
test_activation_and_rollback_paths_use_shared_function_not_current_link
test_pm2_save_never_precedes_activation_attempt
test_activate_pm2_release_asserts_before_health_check_in_source

if [ "$FAILED" -ne 0 ]; then
  echo "pm2-release-binding.sh tests: FAILED"
  exit 1
fi
echo "pm2-release-binding.sh tests: all passed"
