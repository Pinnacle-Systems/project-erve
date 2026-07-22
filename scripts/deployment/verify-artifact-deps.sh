#!/usr/bin/env bash
# Proves the API's installed node_modules are actually complete and usable,
# not merely present. Run after every transformation of the deployment
# tree (right after production deps are installed, after final staging
# assembly, after archive extraction, and on the VPS before activation) so
# an incomplete package (e.g. iconv-lite shipped without its `encodings/`
# directory) fails loudly at the earliest possible checkpoint instead of
# reaching production.
#
# iconv-lite is checked specifically because it is a deep transitive
# dependency (express -> body-parser -> raw-body -> iconv-lite) pulled in
# under this repo's strict, non-hoisted pnpm linking (shamefullyHoist:
# false), so it is not resolvable as a bare `require('iconv-lite')` from
# the API package itself the way a direct dependency would be. Its actual
# on-disk package directory is located by scanning node_modules/.pnpm for
# an `iconv-lite@*` entry rather than hardcoding a version, so this check
# keeps working across dependency upgrades.
#
# Usage: verify-artifact-deps.sh <api-dir>
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

API_DIR="${1:?Usage: verify-artifact-deps.sh <api-dir>}"
[ -d "$API_DIR" ] || erve_die "Not a directory: $API_DIR"
[ -d "$API_DIR/node_modules/.pnpm" ] || erve_die "Missing node_modules/.pnpm in $API_DIR — production dependencies were never installed"

erve_log "Verifying packaged runtime dependencies in $API_DIR"

(
  cd "$API_DIR"
  node -e "
    const fs = require('fs');
    const path = require('path');

    const pnpmDir = path.join(process.cwd(), 'node_modules', '.pnpm');
    const iconvEntries = fs.readdirSync(pnpmDir).filter((d) => d.startsWith('iconv-lite@'));
    if (iconvEntries.length === 0) {
      throw new Error('No iconv-lite@* entry found under ' + pnpmDir);
    }

    for (const entry of iconvEntries) {
      const pkgDir = path.join(pnpmDir, entry, 'node_modules', 'iconv-lite');
      const libIndex = path.join(pkgDir, 'lib', 'index.js');
      const encodingsIndex = path.join(pkgDir, 'encodings', 'index.js');

      if (!fs.existsSync(libIndex)) {
        throw new Error('Missing ' + libIndex);
      }
      if (!fs.existsSync(encodingsIndex)) {
        throw new Error('Missing ' + encodingsIndex + ' (package is missing its encodings/ directory)');
      }

      const iconv = require(pkgDir);
      const decoded = iconv.decode(iconv.encode('deployment-check', 'utf8'), 'utf8');
      if (decoded !== 'deployment-check') {
        throw new Error('iconv-lite functional check failed for ' + entry);
      }
      console.log('iconv-lite dependency check passed: ' + entry);
    }

    require('express');
    console.log('express dependency check passed');
  "
)

erve_log "Runtime dependency verification passed: $API_DIR"
