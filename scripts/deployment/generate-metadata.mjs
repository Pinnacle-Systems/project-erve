#!/usr/bin/env node
// Writes deployment-metadata.json for the production artifact. The
// artifact's own SHA-256 checksum is intentionally NOT embedded here (it
// cannot be known until after this file is already packaged inside the
// tarball) — it is tracked as a sibling `<artifact>.sha256` file alongside
// the tarball instead.
import { readFileSync, writeFileSync } from 'node:fs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    if (!key) continue;
    args[key] = argv[i + 1];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const required = [
  'sha',
  'ref',
  'run-id',
  'node-version',
  'pnpm-version',
  'api-package',
  'web-package',
  'output',
];

for (const key of required) {
  if (!args[key]) {
    throw new Error(`Missing required --${key}`);
  }
}

const apiPkg = JSON.parse(readFileSync(args['api-package'], 'utf8'));
const webPkg = JSON.parse(readFileSync(args['web-package'], 'utf8'));

const metadata = {
  gitCommitSha: args.sha,
  gitRef: args.ref,
  buildTimestamp: new Date().toISOString(),
  nodeVersion: args['node-version'],
  pnpmVersion: args['pnpm-version'],
  apiPackageVersion: apiPkg.version,
  webPackageVersion: webPkg.version,
  buildWorkflowRunId: args['run-id'],
};

writeFileSync(args.output, `${JSON.stringify(metadata, null, 2)}\n`);
console.log(`Wrote ${args.output}`);
