#!/usr/bin/env bash
# Fixture-based tests for cleanup-releases.sh. No real VPS, network, or
# database required — everything runs against a throwaway temp directory
# standing in for DEPLOY_ROOT.
#
# Requires a POSIX filesystem that supports real symlinks for `ln -sfn`
# (Linux — GitHub Actions runners and the VPS both qualify). On Windows
# without Developer Mode / elevated privileges, `ln -sfn` silently falls
# back to creating a plain directory instead of a symlink. cleanup-releases.sh
# now fails closed (refuses to run) whenever `current` isn't a real,
# resolvable symlink, so on such a machine every test that depends on
# `set_current` will report a failure here (a different assertion than the
# one intended) even though the script's own logic is correct — verify by
# code review on such a machine and re-run this suite in CI/on the VPS.
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

FAILED=0

fail() {
  echo "FAIL: $1" >&2
  FAILED=1
}

make_fixture_root() {
  local root
  root="$(mktemp -d)"
  mkdir -p "$root/releases"
  echo "$root"
}

# Deterministic 40-hex-char fake SHA from a small integer, e.g. fake_sha 3
# -> a run of zeros ending in 3.
fake_sha() {
  printf '%040d' "$1"
}

make_release() {
  local root="$1" sha="$2" minutes_ago="$3"
  mkdir -p "$root/releases/$sha/api" "$root/releases/$sha/web"
  : > "$root/releases/$sha/api/server.js"
  touch -d "-${minutes_ago} minutes" "$root/releases/$sha"
}

set_current() {
  local root="$1" sha="$2"
  ln -sfn "$root/releases/$sha" "$root/current"
}

set_previous_marker() {
  local root="$1" sha="$2"
  mkdir -p "$root/.deploy"
  printf '%s\n' "$sha" > "$root/.deploy/previous-release"
}

run_cleanup() {
  local root="$1" retention="${2:-10}"
  DEPLOY_ROOT="$root" ERVE_RELEASE_RETENTION="$retention" bash "$DEPLOYMENT_DIR/cleanup-releases.sh" \
    > "$root/cleanup.log" 2>&1
}

count_present() {
  local root="$1" n="$2" count=0
  for i in $(seq 1 "$n"); do
    [ -d "$root/releases/$(fake_sha "$i")" ] && count=$((count + 1))
  done
  echo "$count"
}

# --- more than ten releases -> exactly 10 kept in total ---------------------
# Also exercises: current is the newest release, and an absolute symlink
# target (set_current always uses one).
test_more_than_ten_releases() {
  local root; root="$(make_fixture_root)"
  # sha 12 is newest (1 minute ago) ... sha 1 is oldest (12 minutes ago)
  for i in $(seq 1 12); do
    make_release "$root" "$(fake_sha "$i")" "$((13 - i))"
  done
  set_current "$root" "$(fake_sha 12)"

  run_cleanup "$root" 10

  local kept; kept="$(count_present "$root" 12)"
  [ "$kept" -eq 10 ] || fail "more_than_ten_releases: expected 10 total kept, got $kept"
  [ -d "$root/releases/$(fake_sha 12)" ] || fail "more_than_ten_releases: current release was deleted"
  [ -d "$root/releases/$(fake_sha 1)" ] && fail "more_than_ten_releases: oldest release should have been removed"
  [ -d "$root/releases/$(fake_sha 2)" ] && fail "more_than_ten_releases: second-oldest release should have been removed"

  rm -rf "$root"
}

# --- current release has an older mtime than several others -----------------
test_current_among_older_timestamps() {
  local root; root="$(make_fixture_root)"
  make_release "$root" "$(fake_sha 1)" 500  # "current" but deliberately the oldest by mtime
  for i in $(seq 2 12); do
    make_release "$root" "$(fake_sha "$i")" "$((13 - i))"
  done
  set_current "$root" "$(fake_sha 1)"

  run_cleanup "$root" 10

  [ -d "$root/releases/$(fake_sha 1)" ] || fail "current_among_older_timestamps: current release was incorrectly deleted despite being the oldest by mtime"
  local kept; kept="$(count_present "$root" 12)"
  [ "$kept" -eq 10 ] || fail "current_among_older_timestamps: expected 10 total kept, got $kept"

  rm -rf "$root"
}

# --- previous known-good release survives at a tight retention boundary,
# inferred purely by mtime (no explicit previous-release marker present) ----
test_previous_among_older_timestamps() {
  local root; root="$(make_fixture_root)"
  make_release "$root" "$(fake_sha 1)" 1000  # much older "previous known-good"
  make_release "$root" "$(fake_sha 2)" 1
  set_current "$root" "$(fake_sha 2)"

  run_cleanup "$root" 2

  [ -d "$root/releases/$(fake_sha 1)" ] || fail "previous_among_older_timestamps: previous known-good release was incorrectly deleted"
  [ -d "$root/releases/$(fake_sha 2)" ] || fail "previous_among_older_timestamps: current release was incorrectly deleted"

  rm -rf "$root"
}

# --- non-SHA-named entries are never touched --------------------------------
test_invalid_directory_names_ignored() {
  local root; root="$(make_fixture_root)"
  make_release "$root" "$(fake_sha 1)" 5
  set_current "$root" "$(fake_sha 1)"
  mkdir -p "$root/releases/not-a-sha"
  mkdir -p "$root/releases/DEADBEEF00000000000000000000000000000000" # uppercase, not matched
  mkdir -p "$root/releases/deadbeef"                                  # short, not matched
  : > "$root/releases/some-file.txt"

  run_cleanup "$root" 1

  [ -d "$root/releases/not-a-sha" ] || fail "invalid_directory_names_ignored: non-SHA directory was incorrectly deleted"
  [ -f "$root/releases/some-file.txt" ] || fail "invalid_directory_names_ignored: stray file was incorrectly deleted"

  rm -rf "$root"
}

# --- retention below 2 is normalized, never drops below current+previous ----
test_retention_below_two_is_normalized() {
  local root; root="$(make_fixture_root)"
  make_release "$root" "$(fake_sha 1)" 10
  make_release "$root" "$(fake_sha 2)" 5
  make_release "$root" "$(fake_sha 3)" 1
  set_current "$root" "$(fake_sha 3)"

  run_cleanup "$root" 1

  local kept; kept="$(count_present "$root" 3)"
  [ "$kept" -eq 2 ] || fail "retention_below_two_is_normalized: expected exactly 2 releases retained (current+previous) after normalizing retention=1, got $kept"
  [ -d "$root/releases/$(fake_sha 3)" ] || fail "retention_below_two_is_normalized: current release was incorrectly deleted"
  [ -d "$root/releases/$(fake_sha 1)" ] && fail "retention_below_two_is_normalized: oldest release should have been removed after normalization"

  rm -rf "$root"
}

# --- current symlink missing entirely -> cleanup refuses to run, deletes
# nothing (fail closed rather than clean up without current protection) -----
test_current_missing_refuses_cleanup() {
  local root; root="$(make_fixture_root)"
  make_release "$root" "$(fake_sha 1)" 10
  make_release "$root" "$(fake_sha 2)" 1
  # deliberately no set_current call — $root/current does not exist

  if run_cleanup "$root" 10; then
    fail "current_missing_refuses_cleanup: cleanup should have refused to run without a current symlink"
  fi
  local kept; kept="$(count_present "$root" 2)"
  [ "$kept" -eq 2 ] || fail "current_missing_refuses_cleanup: no release should be deleted when cleanup refuses to run, got $kept kept"

  rm -rf "$root"
}

# --- current symlink is broken (target does not exist) -> cleanup refuses --
test_current_broken_symlink_refuses_cleanup() {
  local root; root="$(make_fixture_root)"
  make_release "$root" "$(fake_sha 1)" 10
  make_release "$root" "$(fake_sha 2)" 1
  ln -sfn "$root/releases/$(fake_sha 99)" "$root/current" # sha 99 was never created

  if run_cleanup "$root" 10; then
    fail "current_broken_symlink_refuses_cleanup: cleanup should have refused to run with a broken current symlink"
  fi
  local kept; kept="$(count_present "$root" 2)"
  [ "$kept" -eq 2 ] || fail "current_broken_symlink_refuses_cleanup: no release should be deleted when cleanup refuses to run, got $kept kept"

  rm -rf "$root"
}

# --- current points outside releases/ -> cleanup refuses --------------------
test_current_outside_releases_dir_refuses_cleanup() {
  local root; root="$(make_fixture_root)"
  make_release "$root" "$(fake_sha 1)" 10
  mkdir -p "$root/outside"
  ln -sfn "$root/outside" "$root/current"

  if run_cleanup "$root" 10; then
    fail "current_outside_releases_dir_refuses_cleanup: cleanup should have refused when current points outside releases/"
  fi
  [ -d "$root/releases/$(fake_sha 1)" ] || fail "current_outside_releases_dir_refuses_cleanup: release incorrectly deleted after refusal"

  rm -rf "$root"
}

# --- current is a relative symlink target, resolved against its own dir ----
test_current_relative_symlink_target() {
  local root; root="$(make_fixture_root)"
  make_release "$root" "$(fake_sha 1)" 500
  for i in $(seq 2 12); do
    make_release "$root" "$(fake_sha "$i")" "$((13 - i))"
  done
  ln -sfn "releases/$(fake_sha 1)" "$root/current" # relative target

  run_cleanup "$root" 10

  [ -d "$root/releases/$(fake_sha 1)" ] || fail "current_relative_symlink_target: current (relative symlink target) incorrectly deleted"

  rm -rf "$root"
}

# --- explicit previous-release marker protects the true previous known-good
# release even when an orphaned/never-activated release directory (e.g. left
# behind by a failed migration) has a newer mtime and would otherwise squat
# the "previous" slot ---------------------------------------------------------
test_previous_marker_protects_against_orphaned_release() {
  local root; root="$(make_fixture_root)"
  make_release "$root" "$(fake_sha 1)" 100 # true previous known-good, older
  make_release "$root" "$(fake_sha 2)" 50  # orphaned release, never activated, newer mtime
  make_release "$root" "$(fake_sha 3)" 1   # current
  set_current "$root" "$(fake_sha 3)"
  set_previous_marker "$root" "$(fake_sha 1)"

  run_cleanup "$root" 2

  [ -d "$root/releases/$(fake_sha 1)" ] || fail "previous_marker_protects_against_orphaned_release: explicitly recorded previous known-good release was incorrectly deleted"
  [ -d "$root/releases/$(fake_sha 3)" ] || fail "previous_marker_protects_against_orphaned_release: current release was incorrectly deleted"
  [ -d "$root/releases/$(fake_sha 2)" ] && fail "previous_marker_protects_against_orphaned_release: orphaned release should have been removed"

  rm -rf "$root"
}

# --- a corrupted previous-release marker (not a valid full SHA) is never
# used to build a path -> cleanup refuses to run -----------------------------
test_previous_marker_invalid_content_refuses_cleanup() {
  local root; root="$(make_fixture_root)"
  make_release "$root" "$(fake_sha 1)" 10
  set_current "$root" "$(fake_sha 1)"
  mkdir -p "$root/.deploy"
  echo "not-a-sha" > "$root/.deploy/previous-release"

  if run_cleanup "$root" 10; then
    fail "previous_marker_invalid_content_refuses_cleanup: cleanup should refuse a corrupted previous-release marker"
  fi
  [ -d "$root/releases/$(fake_sha 1)" ] || fail "previous_marker_invalid_content_refuses_cleanup: release incorrectly deleted after refusal"

  rm -rf "$root"
}

# --- a previous-release marker naming a release that no longer exists on
# disk is non-fatal (nothing extra to protect) -------------------------------
test_previous_marker_stale_target_is_non_fatal() {
  local root; root="$(make_fixture_root)"
  make_release "$root" "$(fake_sha 1)" 5
  set_current "$root" "$(fake_sha 1)"
  set_previous_marker "$root" "$(fake_sha 99)" # never created on disk

  run_cleanup "$root" 10

  [ -d "$root/releases/$(fake_sha 1)" ] || fail "previous_marker_stale_target_is_non_fatal: current release incorrectly deleted"

  rm -rf "$root"
}

# --- cleanup is only ever invoked after a successful post-deploy health
# check (contract test against deploy-release.sh's own call ordering) -------
test_cleanup_only_called_after_health_check_in_deploy_script() {
  local deploy_script="$DEPLOYMENT_DIR/deploy-release.sh"
  local health_check_line cleanup_line
  # Single-quoted deliberately: this searches deploy-release.sh's source
  # text for the literal call, not an expansion of a variable in this test
  # script. The actual local health check now runs inside
  # erve_activate_pm2_release (lib/common.sh), so the marker to look for in
  # deploy-release.sh itself is the call into that shared function for the
  # newly activated release (see pm2-release-binding.test.sh for direct
  # coverage of erve_activate_pm2_release's own internal ordering).
  # shellcheck disable=SC2016
  health_check_line="$(grep -n 'erve_activate_pm2_release "\$RELEASE_DIR" "\$APP_PORT"' "$deploy_script" | head -1 | cut -d: -f1)"
  cleanup_line="$(grep -n 'cleanup-releases.sh"' "$deploy_script" | head -1 | cut -d: -f1)"

  if [ -z "$health_check_line" ] || [ -z "$cleanup_line" ]; then
    fail "cleanup_only_called_after_health_check: could not locate both calls in deploy-release.sh"
    return
  fi
  [ "$cleanup_line" -gt "$health_check_line" ] \
    || fail "cleanup_only_called_after_health_check: cleanup-releases.sh is called before the post-activation health check in deploy-release.sh"
}

test_more_than_ten_releases
test_current_among_older_timestamps
test_previous_among_older_timestamps
test_invalid_directory_names_ignored
test_retention_below_two_is_normalized
test_current_missing_refuses_cleanup
test_current_broken_symlink_refuses_cleanup
test_current_outside_releases_dir_refuses_cleanup
test_current_relative_symlink_target
test_previous_marker_protects_against_orphaned_release
test_previous_marker_invalid_content_refuses_cleanup
test_previous_marker_stale_target_is_non_fatal
test_cleanup_only_called_after_health_check_in_deploy_script

if [ "$FAILED" -ne 0 ]; then
  echo "cleanup-releases.sh tests: FAILED"
  exit 1
fi
echo "cleanup-releases.sh tests: all passed"
