import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assertExternalArtifactRoot, repositoryRoots } from './artifact-safety.mjs';
const root = resolve(process.argv[2]);
await assertExternalArtifactRoot(root, repositoryRoots(resolve(import.meta.dirname, '../..')));
const a = JSON.parse(await readFile(join(root, 'first-rebuild.json')));
const b = JSON.parse(await readFile(join(root, 'second-rebuild.json')));
const recovery = JSON.parse(await readFile(join(root, 'interruption-rebuild.json')));
const result = {
  status:
    a.snapshot.checksum === b.snapshot.checksum &&
    a.snapshot.checksum === recovery.snapshot.checksum &&
    JSON.stringify(a.snapshot.counts) === JSON.stringify(b.snapshot.counts) &&
    JSON.stringify(a.snapshot.counts) === JSON.stringify(recovery.snapshot.counts) &&
    a.target.name !== b.target.name &&
    a.freshEmpty &&
    b.freshEmpty
      ? 'PASS'
      : 'FAIL',
  firstChecksum: a.snapshot.checksum,
  secondChecksum: b.snapshot.checksum,
  recoveryChecksum: recovery.snapshot.checksum,
  recoveryEquivalent:
    a.snapshot.checksum === recovery.snapshot.checksum &&
    JSON.stringify(a.snapshot.counts) === JSON.stringify(recovery.snapshot.counts),
  counts: a.snapshot.counts,
  independentTargets: a.target.name !== b.target.name,
  firstFresh: a.freshEmpty,
  secondFresh: b.freshEmpty,
};
await writeFile(join(root, 'snapshot-comparison-final.json'), JSON.stringify(result, null, 2), {
  flag: 'wx',
});
console.log(JSON.stringify(result));
if (result.status !== 'PASS') process.exitCode = 1;
