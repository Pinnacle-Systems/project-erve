#!/usr/bin/env bash
# Contract tests for safe same-SHA deployment reruns. These deliberately
# inspect deploy-release.sh because the production entry point also invokes
# NVM, PostgreSQL, PM2, and an actual extracted artifact; the behaviours
# under test here are its ordering and fail-closed release-state contract.
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_SCRIPT="$SCRIPT_DIR/../deploy-release.sh"
FAILED=0

fail() { echo "FAIL: $1" >&2; FAILED=1; }
line() { grep -n "$1" "$DEPLOY_SCRIPT" | head -1 | cut -d: -f1; }

test_state_lifecycle_and_failed_migration_recovery() {
  local created extracted preparing migrating failed completed activated
  created="$(line 'write_release_state created')"
  extracted="$(line 'write_release_state extracted')"
  preparing="$(line 'write_release_state preparing')"
  migrating="$(line 'write_release_state migrating')"
  failed="$(line 'write_release_state failed')"
  completed="$(line 'write_release_state completed')"
  activated="$(line 'write_release_state activated')"
  for value in "$created" "$extracted" "$preparing" "$migrating" "$failed" "$completed" "$activated"; do
    [ -n "$value" ] || { fail "state_lifecycle: missing a required durable state transition"; return; }
  done
  if ! {
    [ "$created" -lt "$extracted" ] &&
      [ "$extracted" -lt "$preparing" ] &&
      [ "$preparing" -lt "$migrating" ]
  }; then
    fail "state_lifecycle: creation/extraction/preparation/migration states are out of order"
  fi
  if ! {
    [ "$migrating" -lt "$completed" ] &&
      [ "$completed" -lt "$activated" ]
  }; then
    fail "state_lifecycle: completed/activated states are out of order"
  fi
  if ! grep -q 'Production migration failed' "$DEPLOY_SCRIPT"; then
    fail "failed_migration_rerun: migration failure is not explicitly reported"
  fi
  if ! grep -q 'Existing incomplete release state detected' "$DEPLOY_SCRIPT"; then
    fail "failed_migration_rerun: incomplete state is not recoverable on rerun"
  fi
}

test_active_release_protection_and_missing_previous_independence() {
  local active resolve remove
  active="$(line 'ACTIVE_RELEASE=.*erve_resolve_release_dir')"
  resolve="$(line 'Active-release protection')"
  remove="$(line 'Removing failed or incomplete release')"
  if ! {
    [ -n "$active" ] &&
      [ -n "$resolve" ] &&
      [ -n "$remove" ]
  }; then
    fail "active_release_protection: required protection code is missing"
    return
  fi
  if ! {
    [ "$active" -lt "$remove" ] &&
      [ "$resolve" -lt "$remove" ]
  }; then
    fail "active_release_protection: canonical current resolution must precede recovery deletion"
  fi
  if ! grep -q 'Refusing to recover or overwrite active release' "$DEPLOY_SCRIPT"; then
    fail "active_release_protection: active release is not rejected"
  fi
  if grep -q 'previous.*symlink\|PREVIOUS_LINK' "$DEPLOY_SCRIPT"; then
    fail "missing_previous_symlink: recovery must not depend on a previous symlink"
  fi
}

test_completed_release_checksum_immutability() {
  local completed checksum remove
  completed="$(line 'Existing completed release state detected')"
  checksum="$(line 'Checksum mismatch for completed release')"
  remove="$(line 'Removing failed or incomplete release')"
  if ! {
    [ -n "$completed" ] &&
      [ -n "$checksum" ]
  }; then
    fail "completed_release_immutability: completed checksum handling is missing"
    return
  fi
  if ! {
    [ "$completed" -lt "$remove" ] &&
      [ "$checksum" -lt "$remove" ]
  }; then
    fail "completed_release_immutability: completed releases must be checked before any deletion path"
  fi
  if ! grep -q 'Completed-release checksum verified; identical artifact already deployed. Skipping safely.' "$DEPLOY_SCRIPT"; then
    fail "same_completed_artifact: expected safe idempotent skip is missing"
  fi
}

test_lock_covers_recovery_and_exit_release() {
  local lock inspect remove
  lock="$(line 'erve_acquire_lock')"
  inspect="$(line 'Existing incomplete release state detected')"
  remove="$(line 'Removing failed or incomplete release')"
  if ! {
    [ -n "$lock" ] &&
      [ -n "$inspect" ] &&
      [ -n "$remove" ]
  }; then
    fail "lock_preservation: required lock/recovery code is missing"
    return
  fi
  if ! {
    [ "$lock" -lt "$inspect" ] &&
      [ "$lock" -lt "$remove" ]
  }; then
    fail "lock_preservation: recovery must occur after lock acquisition"
  fi
  if ! {
    grep -q 'trap deploy_exit EXIT' "$DEPLOY_SCRIPT" &&
      grep -q 'erve_release_lock' "$DEPLOY_SCRIPT"
  }; then
    fail "lock_preservation: lock release must remain protected by an exit trap"
  fi
}

test_state_lifecycle_and_failed_migration_recovery
test_active_release_protection_and_missing_previous_independence
test_completed_release_checksum_immutability
test_lock_covers_recovery_and_exit_release

if [ "$FAILED" -ne 0 ]; then
  echo "deploy-release-recovery tests: FAILED"
  exit 1
fi
echo "deploy-release-recovery tests: all passed"
