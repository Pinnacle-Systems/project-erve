#!/usr/bin/env bash
# Fixture-based tests for verify-artifact-deps.sh. Builds small synthetic
# node_modules trees (not a real pnpm install — no network access needed)
# that mimic the exact on-disk shape pnpm produces for a deep transitive
# dependency (node_modules/.pnpm/<pkg>@<version>/node_modules/<pkg>), so
# these run offline and fast while still exercising the real script logic.
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

FAILED=0

fail() {
  echo "FAIL: $1" >&2
  FAILED=1
}

# Builds a fixture api/ directory with a working iconv-lite@<version> and a
# working express, laid out exactly like pnpm's virtual store.
make_fixture_api_dir() {
  local version="${1:-0.7.2}" dir
  dir="$(mktemp -d)"
  local iconv_dir="$dir/node_modules/.pnpm/iconv-lite@${version}/node_modules/iconv-lite"
  mkdir -p "$iconv_dir/lib" "$iconv_dir/encodings"
  cat > "$iconv_dir/package.json" <<'EOF'
{ "name": "iconv-lite", "main": "./lib/index.js" }
EOF
  cat > "$iconv_dir/lib/index.js" <<'EOF'
exports.encode = function (str) { return Buffer.from(String(str), 'utf8'); };
exports.decode = function (buf) { return Buffer.from(buf).toString('utf8'); };
EOF
  echo "module.exports = {};" > "$iconv_dir/encodings/index.js"

  mkdir -p "$dir/node_modules/express"
  echo "module.exports = {};" > "$dir/node_modules/express/index.js"

  echo "$dir"
}

run_verify() {
  local dir="$1"
  bash "$DEPLOYMENT_DIR/verify-artifact-deps.sh" "$dir"
}

# --- a well-formed fixture passes --------------------------------------------
test_valid_fixture_passes() {
  local dir; dir="$(make_fixture_api_dir)"

  if ! run_verify "$dir" >"$dir/verify.log" 2>&1; then
    fail "valid_fixture_passes: expected verification to succeed"
    cat "$dir/verify.log" >&2
  fi
  grep -q "iconv-lite dependency check passed" "$dir/verify.log" \
    || fail "valid_fixture_passes: expected success log line for iconv-lite"
  grep -q "express dependency check passed" "$dir/verify.log" \
    || fail "valid_fixture_passes: expected success log line for express"

  rm -rf "$dir"
}

# --- this is the exact production regression: encodings/index.js missing
# from an otherwise-present iconv-lite package must fail verification -------
test_missing_encodings_directory_fails() {
  local dir; dir="$(make_fixture_api_dir)"
  rm -f "$dir"/node_modules/.pnpm/iconv-lite@*/node_modules/iconv-lite/encodings/index.js

  if run_verify "$dir" >"$dir/verify.log" 2>&1; then
    fail "missing_encodings_directory_fails: verification should have failed with encodings/index.js removed"
  fi
  grep -qi "encodings" "$dir/verify.log" \
    || fail "missing_encodings_directory_fails: failure output should mention the missing encodings path"

  rm -rf "$dir"
}

# --- a missing lib/index.js (the other half of the package) also fails ------
test_missing_lib_index_fails() {
  local dir; dir="$(make_fixture_api_dir)"
  rm -f "$dir"/node_modules/.pnpm/iconv-lite@*/node_modules/iconv-lite/lib/index.js

  if run_verify "$dir" >"$dir/verify.log" 2>&1; then
    fail "missing_lib_index_fails: verification should have failed with lib/index.js removed"
  fi

  rm -rf "$dir"
}

# --- two different iconv-lite@<version> entries can legitimately coexist
# under node_modules/.pnpm (unresolvable version ranges across different
# transitive dependency chains) — verification must check every entry, not
# just the first one readdir happens to return, or a damaged second copy
# could ship silently behind an intact first one -----------------------------
add_second_iconv_lite_entry() {
  local dir="$1" version="$2"
  local iconv_dir="$dir/node_modules/.pnpm/iconv-lite@${version}/node_modules/iconv-lite"
  mkdir -p "$iconv_dir/lib" "$iconv_dir/encodings"
  cat > "$iconv_dir/package.json" <<'EOF'
{ "name": "iconv-lite", "main": "./lib/index.js" }
EOF
  cat > "$iconv_dir/lib/index.js" <<'EOF'
exports.encode = function (str) { return Buffer.from(String(str), 'utf8'); };
exports.decode = function (buf) { return Buffer.from(buf).toString('utf8'); };
EOF
  echo "module.exports = {};" > "$iconv_dir/encodings/index.js"
}

test_second_damaged_iconv_lite_entry_fails_even_with_first_intact() {
  local dir; dir="$(make_fixture_api_dir "0.7.2")"
  add_second_iconv_lite_entry "$dir" "0.4.24"
  # Damage only the second entry — the first (0.7.2) stays fully intact.
  rm -f "$dir/node_modules/.pnpm/iconv-lite@0.4.24/node_modules/iconv-lite/encodings/index.js"

  if run_verify "$dir" >"$dir/verify.log" 2>&1; then
    fail "second_damaged_iconv_lite_entry_fails: verification should fail when any installed iconv-lite@* copy is damaged, even if another copy is intact"
    cat "$dir/verify.log" >&2
  fi
  grep -q "iconv-lite@0.4.24" "$dir/verify.log" \
    || fail "second_damaged_iconv_lite_entry_fails: failure output should name the specific damaged version (0.4.24), not just fail generically"

  rm -rf "$dir"
}

# --- iconv-lite present and intact, but express missing -> still fails ------
test_missing_express_fails() {
  local dir; dir="$(make_fixture_api_dir)"
  rm -rf "$dir/node_modules/express"

  if run_verify "$dir" >"$dir/verify.log" 2>&1; then
    fail "missing_express_fails: verification should have failed without express installed"
  fi

  rm -rf "$dir"
}

# --- no node_modules/.pnpm at all (dependencies never installed) fails
# immediately with a clear message, not a confusing Node stack trace --------
test_missing_pnpm_store_fails_closed() {
  local dir; dir="$(mktemp -d)"

  if run_verify "$dir" >"$dir/verify.log" 2>&1; then
    fail "missing_pnpm_store_fails_closed: verification should have failed with no node_modules/.pnpm present"
  fi
  grep -qi "node_modules/.pnpm" "$dir/verify.log" \
    || fail "missing_pnpm_store_fails_closed: failure output should mention the missing node_modules/.pnpm directory"

  rm -rf "$dir"
}

# --- version-independent: an iconv-lite version other than whatever is
# currently pinned in pnpm-lock.yaml is still discovered and checked --------
test_version_independent_discovery() {
  local dir; dir="$(make_fixture_api_dir "9.9.9-not-a-real-release")"

  if ! run_verify "$dir" >"$dir/verify.log" 2>&1; then
    fail "version_independent_discovery: verification should not hardcode a specific iconv-lite version"
    cat "$dir/verify.log" >&2
  fi
  grep -q "iconv-lite@9.9.9-not-a-real-release" "$dir/verify.log" \
    || fail "version_independent_discovery: expected the discovered version to appear in the log output"

  rm -rf "$dir"
}

# --- deploy-release.sh calls this verification before migrations and
# before activating the current symlink (contract test against its own
# call ordering) --------------------------------------------------------------
test_verification_runs_before_migrate_and_activation_in_deploy_script() {
  local deploy_script="$DEPLOYMENT_DIR/deploy-release.sh"
  local verify_line migrate_line activate_line
  # Single-quoted deliberately: this searches deploy-release.sh's source
  # text for the literal string "$RELEASE_DIR/api", not an expansion of a
  # variable in this test script.
  # shellcheck disable=SC2016
  verify_line="$(grep -n 'verify-artifact-deps.sh" "\$RELEASE_DIR/api"' "$deploy_script" | head -1 | cut -d: -f1)"
  migrate_line="$(grep -n 'prisma migrate deploy' "$deploy_script" | head -1 | cut -d: -f1)"
  activate_line="$(grep -n 'Atomically activating release' "$deploy_script" | head -1 | cut -d: -f1)"

  if [ -z "$verify_line" ] || [ -z "$migrate_line" ] || [ -z "$activate_line" ]; then
    fail "verification_runs_before_migrate_and_activation: could not locate all three calls in deploy-release.sh"
    return
  fi
  [ "$verify_line" -lt "$migrate_line" ] \
    || fail "verification_runs_before_migrate_and_activation: dependency verification must run before 'prisma migrate deploy'"
  [ "$verify_line" -lt "$activate_line" ] \
    || fail "verification_runs_before_migrate_and_activation: dependency verification must run before activating the current symlink"
}

test_valid_fixture_passes
test_missing_encodings_directory_fails
test_missing_lib_index_fails
test_second_damaged_iconv_lite_entry_fails_even_with_first_intact
test_missing_express_fails
test_missing_pnpm_store_fails_closed
test_version_independent_discovery
test_verification_runs_before_migrate_and_activation_in_deploy_script

if [ "$FAILED" -ne 0 ]; then
  echo "verify-artifact-deps.sh tests: FAILED"
  exit 1
fi
echo "verify-artifact-deps.sh tests: all passed"
