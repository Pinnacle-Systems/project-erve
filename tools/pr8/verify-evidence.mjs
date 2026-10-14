import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { assertExternalArtifactRoot, repositoryRoots } from './artifact-safety.mjs';
const repository = resolve(import.meta.dirname, '../..'),
  runRoot = resolve(process.argv[2]);
await assertExternalArtifactRoot(runRoot, repositoryRoots(repository));
const { directory } = JSON.parse(await readFile(join(runRoot, 'evidence-latest.json')));
await assertExternalArtifactRoot(directory, repositoryRoots(repository));
const manifest = JSON.parse(await readFile(join(directory, 'manifest.json')));
const require = createRequire(join(repository, 'apps/api/package.json'));
const values = require('dotenv').parse(await readFile(join(repository, 'apps/api/.env')));
const secrets = [
  values.JWT_ACCESS_SECRET,
  values.JWT_REFRESH_SECRET,
  values.DATABASE_URL,
  values.TEST_DATABASE_URL,
];
for (const profile of ['first', 'second', 'interruption', 'regression'])
  secrets.push((await readFile(join(runRoot, `${profile}-password.txt`), 'utf8')).trimEnd());
const config = JSON.parse(await readFile(join(runRoot, 'first-config.json')));
const credentials = JSON.parse(
  await readFile(join(config.reportRoot, 'operational-fixture-credentials.json')),
);
for (const credential of Object.values(credentials)) secrets.push(credential.password);
let pngs = 0;
for (const entry of manifest.files) {
  const file = resolve(directory, entry.path),
    local = relative(directory, file);
  if (!local || local.startsWith('..') || isAbsolute(local))
    throw Error('Manifest path escaped evidence directory');
  const bytes = await readFile(file);
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
    throw Error(`Evidence checksum mismatch: ${entry.path}`);
  if (
    secrets
      .filter((value) => value && value.length >= 12)
      .some((secret) => bytes.includes(Buffer.from(secret)))
  )
    throw Error(`Private secret found in evidence: ${entry.path}`);
  if (entry.path.endsWith('.png')) {
    if (
      bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      !bytes.readUInt32BE(16) ||
      !bytes.readUInt32BE(20)
    )
      throw Error('Invalid evidence PNG');
    pngs++;
  }
}
await writeFile(
  join(runRoot, 'evidence-verification.json'),
  JSON.stringify(
    {
      status: 'PASS',
      directory,
      files: manifest.files.length,
      verifiedPngs: pngs,
      privateSecretScan: 'PASS',
      sourceCommit: manifest.source.commit,
      timestamp: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    status: 'PASS',
    files: manifest.files.length,
    verifiedPngs: pngs,
    privateSecretScan: 'PASS',
  }),
);
