#!/usr/bin/env node
// Writes a minimal production package.json for the API deployment artifact:
// only the real npm runtime dependencies (workspace @erve/* packages are
// already inlined into the esbuild bundle, so they are deliberately
// excluded here). This file is documentation/metadata only — the actual
// node_modules installed into the release directory come from `pnpm
// deploy` (see package-production.sh), which installs from apps/api's own
// package.json and the repository's frozen lockfile, not from this
// generated file.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , sourcePath, destPath] = process.argv;

if (!sourcePath || !destPath) {
  console.error('Usage: generate-prod-package-json.mjs <source apps/api/package.json> <dest path>');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(sourcePath, 'utf8'));

const runtimeDeps = Object.fromEntries(
  Object.entries(pkg.dependencies ?? {}).filter(([name]) => !name.startsWith('@erve/')),
);

if (!runtimeDeps.prisma) {
  throw new Error(
    'Expected "prisma" as a real runtime dependency in apps/api/package.json — it must run `prisma migrate deploy` ' +
      'on the VPS, so it cannot live in devDependencies (pnpm deploy --prod would exclude it from the artifact).',
  );
}

const prodPackage = {
  name: pkg.name,
  version: pkg.version,
  private: true,
  type: pkg.type,
  dependencies: runtimeDeps,
};

writeFileSync(destPath, `${JSON.stringify(prodPackage, null, 2)}\n`);
console.log(`Wrote ${destPath} with ${Object.keys(runtimeDeps).length} runtime dependencies`);
