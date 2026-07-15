#!/usr/bin/env bash
# Builds the production deployment artifact. Must run on the GitHub
# Actions runner (or an equivalent full monorepo checkout) — never on the
# VPS. Assumes `pnpm install --frozen-lockfile` has already been run and
# that typecheck/lint/tests have already passed for this commit.
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=./lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

erve_require_env GITHUB_SHA

OUTPUT_DIR="${OUTPUT_DIR:-$REPO_ROOT/.deploy-build}"
RELEASE_DIR="$OUTPUT_DIR/release"
ARTIFACT_PATH="${ARTIFACT_PATH:-$OUTPUT_DIR/erve-release-${GITHUB_SHA}.tar.gz}"

rm -rf "$OUTPUT_DIR"
mkdir -p "$RELEASE_DIR/api" "$RELEASE_DIR/web"

cd "$REPO_ROOT"

erve_log "Generating Prisma client"
pnpm --filter @erve/api prisma:generate

erve_log "Building web frontend (same-origin /api base URL)"
VITE_API_URL=/api pnpm --filter @erve/web build

erve_log "Bundling API with esbuild"
pnpm --filter @erve/api bundle

erve_log "Assembling web artifact"
cp -r apps/web/dist/. "$RELEASE_DIR/web/"

erve_log "Assembling API artifact"
cp apps/api/dist-bundle/server.js "$RELEASE_DIR/api/server.js"
mkdir -p "$RELEASE_DIR/api/prisma"
cp apps/api/prisma/schema.prisma "$RELEASE_DIR/api/prisma/schema.prisma"
cp -r apps/api/prisma/migrations "$RELEASE_DIR/api/prisma/migrations"
cp "$REPO_ROOT/deployment/pm2/ecosystem.config.cjs" "$RELEASE_DIR/api/ecosystem.config.cjs"

erve_log "Writing minimal production package.json for API runtime dependencies"
node "$SCRIPT_DIR/generate-prod-package-json.mjs" \
  "$REPO_ROOT/apps/api/package.json" \
  "$RELEASE_DIR/api/package.json"

# This standalone install is deliberately isolated from the monorepo's
# pnpm-workspace.yaml (--ignore-workspace stops pnpm walking up to find
# it), so it needs its own copy of the same install-script allowlist —
# without it, Prisma's postinstall step (which fetches its migration
# engine) is silently skipped and `prisma migrate deploy` breaks on the VPS.
cat > "$RELEASE_DIR/api/pnpm-workspace.yaml" <<'EOF'
packages: []
allowBuilds:
  '@prisma/client': true
  '@prisma/engines': true
  prisma: true
EOF

erve_log "Installing production runtime dependencies for the API artifact (build runner only, never the VPS)"
(
  cd "$RELEASE_DIR/api"
  pnpm install --prod --lockfile=false
)
rm -f "$RELEASE_DIR/api/pnpm-workspace.yaml"

erve_log "Writing deployment metadata"
node "$SCRIPT_DIR/generate-metadata.mjs" \
  --sha "$GITHUB_SHA" \
  --ref "${GITHUB_REF:-unknown}" \
  --run-id "${GITHUB_RUN_ID:-local}" \
  --node-version "$(node --version)" \
  --pnpm-version "$(pnpm --version)" \
  --api-package "$REPO_ROOT/apps/api/package.json" \
  --web-package "$REPO_ROOT/apps/web/package.json" \
  --output "$RELEASE_DIR/deployment-metadata.json"

erve_log "Scanning artifact for forbidden files"
"$SCRIPT_DIR/scan-artifact.sh" "$RELEASE_DIR"

erve_log "Creating tarball"
tar -C "$OUTPUT_DIR" -czf "$ARTIFACT_PATH" release

sha256sum "$ARTIFACT_PATH" | awk '{print $1}' > "${ARTIFACT_PATH}.sha256"

ARTIFACT_SIZE="$(du -h "$ARTIFACT_PATH" | cut -f1)"
RELEASE_SIZE="$(du -sh "$RELEASE_DIR" | cut -f1)"
erve_log "Artifact created: $ARTIFACT_PATH (compressed: $ARTIFACT_SIZE, extracted: $RELEASE_SIZE)"
erve_log "Checksum: $(cat "${ARTIFACT_PATH}.sha256")"
