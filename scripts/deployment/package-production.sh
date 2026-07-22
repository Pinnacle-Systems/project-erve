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

# `pnpm deploy` (not a hand-rolled `pnpm install --lockfile=false`) is the
# supported, reproducible way to extract one workspace package's production
# dependency tree into a self-contained, relocatable directory. Critically,
# it resolves every version from the repository's own frozen pnpm-lock.yaml
# (already installed earlier in this workflow via `pnpm install
# --frozen-lockfile`) rather than re-resolving ranges against the live
# registry — the previous `--lockfile=false` reinstall silently drifted onto
# whatever newest matching versions happened to be available at package time
# (observed: iconv-lite 0.7.3 here vs. the tested/locked 0.7.2), bypassing
# this repo's supply-chain policy (minimumReleaseAge in the root
# pnpm-workspace.yaml) in the process since the isolated install directory
# had no workspace config of its own to inherit it from.
# --legacy is used deliberately: the non-legacy implementation requires
# `inject-workspace-packages=true` workspace-wide, which would change how
# every package in the monorepo links its workspace siblings just to
# support this one deployment step.
# Deploys directly into $RELEASE_DIR/api (rather than a separate staging
# directory that gets `cp -r`'d in afterwards) so pnpm's own symlinked
# node_modules structure is written once, by pnpm, and never re-copied by
# a generic recursive copy that isn't guaranteed to preserve symlinks
# faithfully on every platform.
erve_log "Deploying API production dependencies via 'pnpm deploy' (frozen lockfile, build runner only, never the VPS)"
rmdir "$RELEASE_DIR/api" 2>/dev/null || erve_die "$RELEASE_DIR/api must be empty before 'pnpm deploy' writes into it"
pnpm --filter @erve/api deploy "$RELEASE_DIR/api" --prod --legacy

erve_log "Checkpoint: verifying runtime dependencies immediately after installation"
"$SCRIPT_DIR/verify-artifact-deps.sh" "$RELEASE_DIR/api"

# `pnpm deploy` copies the whole @erve/api package (TypeScript source,
# tsc's own `dist/`, lint/test/bundler config) alongside node_modules — none
# of that belongs in the production artifact, which ships the esbuild
# bundle instead. Only node_modules (already verified above) and the
# prisma/ directory (overwritten with a fresh copy below anyway) are kept.
erve_log "Removing non-runtime source files copied in by 'pnpm deploy'"
find "$RELEASE_DIR/api" -mindepth 1 -maxdepth 1 \
  ! -name node_modules ! -name prisma -exec rm -rf {} +

erve_log "Assembling API artifact"
cp apps/api/dist-bundle/server.js "$RELEASE_DIR/api/server.js"
cp apps/api/dist-bundle/admin-bootstrap.js "$RELEASE_DIR/api/admin-bootstrap.js"
cp apps/api/dist-bundle/roles-bootstrap.js "$RELEASE_DIR/api/roles-bootstrap.js"
# prisma.config.ts supplies datasource.url (schema.prisma's datasource block
# deliberately has no `url`) — without it on the VPS, `prisma migrate deploy`
# fails with "The datasource.url property is required in your Prisma config
# file", since there is nowhere else for it to come from.
cp apps/api/prisma.config.ts "$RELEASE_DIR/api/prisma.config.ts"
rm -rf "$RELEASE_DIR/api/prisma"
mkdir -p "$RELEASE_DIR/api/prisma"
cp apps/api/prisma/schema.prisma "$RELEASE_DIR/api/prisma/schema.prisma"
cp -r apps/api/prisma/migrations "$RELEASE_DIR/api/prisma/migrations"
cp "$REPO_ROOT/deployment/pm2/ecosystem.config.cjs" "$RELEASE_DIR/api/ecosystem.config.cjs"

erve_log "Writing minimal production package.json for the API artifact (documentation/runtime metadata only — dependencies were already installed above by 'pnpm deploy' from the repository's own package.json/lockfile)"
node "$SCRIPT_DIR/generate-prod-package-json.mjs" \
  "$REPO_ROOT/apps/api/package.json" \
  "$RELEASE_DIR/api/package.json"

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

erve_log "Checkpoint: verifying runtime dependencies in the final staging directory"
"$SCRIPT_DIR/verify-artifact-deps.sh" "$RELEASE_DIR/api"

erve_log "Creating tarball"
tar -C "$OUTPUT_DIR" -czf "$ARTIFACT_PATH" release

sha256sum "$ARTIFACT_PATH" | awk '{print $1}' > "${ARTIFACT_PATH}.sha256"

ARTIFACT_SIZE="$(du -h "$ARTIFACT_PATH" | cut -f1)"
RELEASE_SIZE="$(du -sh "$RELEASE_DIR" | cut -f1)"
erve_log "Artifact created: $ARTIFACT_PATH (compressed: $ARTIFACT_SIZE, extracted: $RELEASE_SIZE)"
erve_log "Checksum: $(cat "${ARTIFACT_PATH}.sha256")"

# Verifies the archive itself, not just the pre-tar workspace — production
# runs the extracted artifact, and tar/upload/download are exactly the
# steps this pipeline previously had zero checks on. Left behind at
# $OUTPUT_DIR/verify-extract (not cleaned up here) so later CI steps in the
# same job can smoke-test the real packaged API — the process production
# will actually run — instead of the unarchived $RELEASE_DIR.
VERIFY_EXTRACT_DIR="$OUTPUT_DIR/verify-extract"
erve_log "Checkpoint: extracting the archive into $VERIFY_EXTRACT_DIR to verify it independently of the workspace"
rm -rf "$VERIFY_EXTRACT_DIR"
mkdir -p "$VERIFY_EXTRACT_DIR"
tar -xzf "$ARTIFACT_PATH" -C "$VERIFY_EXTRACT_DIR" --strip-components=1
"$SCRIPT_DIR/verify-artifact-deps.sh" "$VERIFY_EXTRACT_DIR/api"
erve_log "Archive verification passed: $VERIFY_EXTRACT_DIR"
