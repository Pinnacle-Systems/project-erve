#!/usr/bin/env bash
# Fails packaging if the assembled release directory contains .env files,
# private key material, or leftover .git metadata. Run against the release/
# staging directory before it is tarred up.
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

RELEASE_DIR="${1:?Usage: scan-artifact.sh <release-dir>}"

erve_log "Scanning $RELEASE_DIR for forbidden files"

found=0

while IFS= read -r -d '' f; do
  erve_log "Forbidden file present in artifact: $f"
  found=1
done < <(find "$RELEASE_DIR" -type f -name '.env' -print0)

while IFS= read -r -d '' f; do
  erve_log "Forbidden .git metadata present in artifact: $f"
  found=1
done < <(find "$RELEASE_DIR" -type d -name '.git' -print0)

# node_modules is excluded from the content scan: it is guaranteed to
# contain third-party README/test fixtures that mention PEM headers as
# documentation examples (e.g. dotenv's own README), which would otherwise
# be a constant false positive. It is still covered by the .env and .git
# checks above.
KEY_MATCHES="$(grep -rlI --exclude-dir=node_modules -E 'BEGIN (RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY' "$RELEASE_DIR" 2>/dev/null || true)"
if [ -n "$KEY_MATCHES" ]; then
  erve_log "Artifact appears to contain private key material:"
  printf '%s\n' "$KEY_MATCHES" >&2
  found=1
fi

if [ "$found" -ne 0 ]; then
  erve_die "Artifact scan failed — forbidden files detected, refusing to package"
fi

erve_log "Artifact scan passed"
