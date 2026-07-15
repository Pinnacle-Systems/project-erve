#!/usr/bin/env node
// Writes a minimal production package.json for the API deployment artifact:
// only the real npm runtime dependencies (workspace @erve/* packages are
// already inlined into the esbuild bundle, so they are deliberately
// excluded here) plus the `prisma` CLI, pinned to the same version as the
// repository's devDependency, so `node_modules/.bin/prisma migrate deploy`
// is available on the VPS without a full monorepo install.
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

const prismaVersion = pkg.devDependencies?.prisma;
if (!prismaVersion) {
  throw new Error(
    'Expected a "prisma" devDependency in apps/api/package.json to pin the production migration CLI version.',
  );
}
runtimeDeps.prisma = prismaVersion;

const prodPackage = {
  name: pkg.name,
  version: pkg.version,
  private: true,
  type: pkg.type,
  dependencies: runtimeDeps,
};

writeFileSync(destPath, `${JSON.stringify(prodPackage, null, 2)}\n`);
console.log(`Wrote ${destPath} with ${Object.keys(runtimeDeps).length} runtime dependencies`);
