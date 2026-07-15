#!/usr/bin/env bash
# Fixture-based tests for cleanup-backups.sh. No real Postgres/pg_dump
# required — the actual dump step lives in backup-database.sh and is not
# exercised here, only the file-retention logic that runs after it.
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
  mkdir -p "$root/shared/backups"
  echo "$root"
}

# Deterministic, convention-matching backup filename from a small integer
# offset in minutes, e.g. fake_backup 5 -> erve-<timestamp 5 min ago>.dump
fake_backup_name() {
  local minutes_ago="$1"
  date -u -d "-${minutes_ago} minutes" +'erve-%Y%m%dT%H%M%SZ.dump'
}

make_backup() {
  local root="$1" minutes_ago="$2" name
  name="$(fake_backup_name "$minutes_ago")"
  echo "fake dump content" > "$root/shared/backups/$name"
  touch -d "-${minutes_ago} minutes" "$root/shared/backups/$name"
  echo "$root/shared/backups/$name"
}

run_cleanup() {
  local root="$1" retention="$2" just_created="${3:-}"
  DEPLOY_ROOT="$root" ERVE_DB_BACKUP_RETENTION="$retention" \
    bash "$DEPLOYMENT_DIR/cleanup-backups.sh" "$just_created" > "$root/cleanup.log" 2>&1
}

count_backups() {
  find "$1/shared/backups" -mindepth 1 -maxdepth 1 -type f -name 'erve-*.dump' | wc -l | tr -d ' '
}

# --- more backups than the configured limit ---------------------------------
test_more_backups_than_limit() {
  local root; root="$(make_fixture_root)"
  local paths=()
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    paths+=("$(make_backup "$root" "$i")")
  done
  local newest="${paths[0]}" # minutes_ago=1, i.e. the newest

  run_cleanup "$root" 10 "$newest"

  local kept; kept="$(count_backups "$root")"
  [ "$kept" -eq 10 ] || fail "more_backups_than_limit: expected 10 backups retained, got $kept"
  [ -f "$newest" ] || fail "more_backups_than_limit: just-created (newest) backup was incorrectly deleted"

  rm -rf "$root"
}

# --- invalid filenames are never touched ------------------------------------
test_invalid_filenames_ignored() {
  local root; root="$(make_fixture_root)"
  make_backup "$root" 1 >/dev/null
  echo "not a real backup" > "$root/shared/backups/backup.sql"
  echo "wrong extension" > "$root/shared/backups/erve-20260101T000000Z.dump.gz"
  echo "wrong prefix" > "$root/shared/backups/other-20260101T000000Z.dump"

  run_cleanup "$root" 1 ""

  [ -f "$root/shared/backups/backup.sql" ] || fail "invalid_filenames_ignored: unrelated file was incorrectly deleted"
  [ -f "$root/shared/backups/erve-20260101T000000Z.dump.gz" ] || fail "invalid_filenames_ignored: wrong-extension file was incorrectly deleted"
  [ -f "$root/shared/backups/other-20260101T000000Z.dump" ] || fail "invalid_filenames_ignored: wrong-prefix file was incorrectly deleted"

  rm -rf "$root"
}

# --- the backup just created is always protected, even if retention=1 and
# it isn't actually the newest by mtime (clock skew, etc.) -------------------
test_just_created_backup_is_protected() {
  local root; root="$(make_fixture_root)"
  make_backup "$root" 1 >/dev/null
  local just_created
  just_created="$(make_backup "$root" 100)" # deliberately "older" by mtime

  run_cleanup "$root" 1 "$just_created"

  [ -f "$just_created" ] || fail "just_created_backup_is_protected: just-created backup was incorrectly deleted"
  local kept; kept="$(count_backups "$root")"
  [ "$kept" -eq 1 ] || fail "just_created_backup_is_protected: expected exactly 1 backup retained, got $kept"

  rm -rf "$root"
}

# --- retention below 1 is normalized to 1, never deletes everything ---------
test_retention_below_one_is_normalized() {
  local root; root="$(make_fixture_root)"
  local just_created
  just_created="$(make_backup "$root" 1)"
  make_backup "$root" 5 >/dev/null

  run_cleanup "$root" 0 "$just_created"

  [ -f "$just_created" ] || fail "retention_below_one_is_normalized: just-created backup was incorrectly deleted with retention=0"
  local kept; kept="$(count_backups "$root")"
  [ "$kept" -ge 1 ] || fail "retention_below_one_is_normalized: expected at least 1 backup retained, got $kept"

  rm -rf "$root"
}

# --- an empty/failed new backup must never be passed to cleanup as
# "just created" — contract test against backup-database.sh's own ordering --
test_empty_backup_never_reaches_cleanup() {
  local backup_script="$DEPLOYMENT_DIR/backup-database.sh"
  local empty_check_line cleanup_call_line
  # Single-quoted deliberately: this searches backup-database.sh's source
  # text for the literal string "$BACKUP_FILE", not an expansion of a
  # variable in this test script.
  # shellcheck disable=SC2016
  empty_check_line="$(grep -n '\-s "\$BACKUP_FILE"' "$backup_script" | head -1 | cut -d: -f1)"
  cleanup_call_line="$(grep -n 'cleanup-backups.sh"' "$backup_script" | head -1 | cut -d: -f1)"

  if [ -z "$empty_check_line" ] || [ -z "$cleanup_call_line" ]; then
    fail "empty_backup_never_reaches_cleanup: could not locate both the empty-file check and the cleanup call in backup-database.sh"
    return
  fi
  [ "$cleanup_call_line" -gt "$empty_check_line" ] \
    || fail "empty_backup_never_reaches_cleanup: cleanup-backups.sh is invoked before the non-empty check in backup-database.sh"
}

# --- canonical-path safety: a path outside the backups directory is
# rejected rather than silently accepted as "just created" -------------------
test_rejects_just_created_path_outside_backup_dir() {
  local root; root="$(make_fixture_root)"
  make_backup "$root" 1 >/dev/null
  local outside
  outside="$(mktemp)"

  if DEPLOY_ROOT="$root" ERVE_DB_BACKUP_RETENTION=10 bash "$DEPLOYMENT_DIR/cleanup-backups.sh" "$outside" >"$root/cleanup.log" 2>&1; then
    fail "rejects_just_created_path_outside_backup_dir: cleanup-backups.sh should have failed for a path outside shared/backups"
  fi

  rm -f "$outside"
  rm -rf "$root"
}

test_more_backups_than_limit
test_invalid_filenames_ignored
test_just_created_backup_is_protected
test_retention_below_one_is_normalized
test_empty_backup_never_reaches_cleanup
test_rejects_just_created_path_outside_backup_dir

if [ "$FAILED" -ne 0 ]; then
  echo "cleanup-backups.sh tests: FAILED"
  exit 1
fi
echo "cleanup-backups.sh tests: all passed"
