import 'dotenv/config';
import { readFile, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { prisma } from '../db/prisma.js';
import { planDisposableRebuild } from './disposable-rebuild.js';
import { loadRebuildInputs, rebuildChecksum } from './disposable-rebuild-inputs.js';
import { currentUserSelect, toCurrentUser } from '../auth/current-user.js';
import {
  planMasterImport,
  executeMasterImport,
} from '../modules/master-data/master-import.service.js';

async function main() {
  const runRoot = process.env.PR8_RUN_ROOT!;
  const config = JSON.parse(await readFile(process.env.PR8_CONFIG!, 'utf8'));
  const guarded = await planDisposableRebuild(config, {
    execute: false,
    confirmWrite: false,
    repositoryRoot: path.resolve(import.meta.dirname, '../../../..'),
  });
  if (!guarded.target.owned)
    throw new Error('Correction acceptance requires an owned disposable target');
  if (path.resolve(runRoot) !== path.dirname(path.resolve(config.reportRoot)))
    throw new Error('PR8 run root must be the verified external report parent');
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: config.adminEmail },
    select: currentUserSelect,
  });
  const actor = toCurrentUser(user);
  const sourceRoot = path.join(runRoot, 'synthetic-correction-source');
  await cp(config.sourceRoot, sourceRoot, { recursive: true, force: false, errorOnExist: true });
  const fixture = {
    Name: 'PR8 ENGINEERING ONLY CONTROLLED CORRECTION',
    GSTIN: '33ZZZZZ9996Z1Z9',
    'Purchase Mode': '',
    'Address Line 1': 'Synthetic correction fixture address',
    'Source Key': 'pr8:synthetic:controlled-correction',
    'Source Provenance': JSON.stringify({
      engineeringOnly: true,
      caseId: 'PR8-C',
      original: 'synthetic-unresolved',
      corrections: 'synthetic-corrections.json',
    }),
  };
  const file = (row: Record<string, string>) =>
    Buffer.from(XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet([row])));
  const original = file(fixture);
  const initial = await planMasterImport(actor, 'distributors', original, 'synthetic.csv');
  if (initial.rows[0]?.outcome !== 'NEEDS_REVIEW')
    throw new Error('Missing synthetic Purchase Mode must require review');
  const corrected = file({ ...fixture, 'Purchase Mode': 'OUTRIGHT' });
  let staleRejected = false;
  try {
    await executeMasterImport(
      actor,
      'distributors',
      corrected,
      'synthetic.csv',
      undefined,
      initial.confirmationToken,
    );
  } catch {
    staleRejected = true;
  }
  if (!staleRejected) throw new Error('Old confirmation authorized changed input');
  const filePath = path.join(sourceRoot, config.files.distributors);
  await writeFile(filePath, corrected);
  let checksumRejected = false;
  try {
    await loadRebuildInputs({ ...config, sourceRoot });
  } catch {
    checksumRejected = true;
  }
  if (!checksumRejected) throw new Error('Changed canonical source accepted with old seal');
  const manifestPath = path.join(sourceRoot, config.manifestFile);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.outputs.find(
    (entry: { file: string }) => entry.file === config.files.distributors,
  ).sha256 = rebuildChecksum(corrected);
  const manifestBytes = JSON.stringify(manifest, null, 2);
  await writeFile(manifestPath, manifestBytes);
  const resealed = {
    ...config,
    sourceRoot,
    manifestSha256: rebuildChecksum(manifestBytes),
    syntheticCorrections: [
      {
        field: 'Purchase Mode',
        value: 'OUTRIGHT',
        sourceKey: fixture['Source Key'],
        reason: 'PR8 explicitly synthetic correction; no historical commercial identity modified',
      },
    ],
  };
  await writeFile(
    path.join(runRoot, 'synthetic-corrections.json'),
    JSON.stringify(
      {
        caseId: 'PR8-C',
        engineeringOnly: true,
        beforeSha256: rebuildChecksum(original),
        afterSha256: rebuildChecksum(corrected),
        corrections: resealed.syntheticCorrections,
      },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  await writeFile(
    path.join(runRoot, 'synthetic-correction-config.json'),
    JSON.stringify(resealed, null, 2),
    { flag: 'wx' },
  );
  await loadRebuildInputs(resealed);
  const preview = await planMasterImport(actor, 'distributors', corrected, 'synthetic.csv');
  const result = await executeMasterImport(
    actor,
    'distributors',
    corrected,
    'synthetic.csv',
    undefined,
    preview.confirmationToken,
  );
  if (result.rows[0]?.outcome !== 'CREATE')
    throw new Error('Valid synthetic correction was not imported');
  const conflict = await planMasterImport(
    actor,
    'distributors',
    file({
      ...fixture,
      'Purchase Mode': 'OUTRIGHT',
      'Address Line 1': 'Different synthetic address',
    }),
    'synthetic.csv',
  );
  if (conflict.rows[0]?.outcome !== 'NEEDS_REVIEW')
    throw new Error('Existing values must not be silently overwritten');
  const stored = await prisma.distributor.findFirstOrThrow({ where: { name: fixture.Name } });
  const provenance = await prisma.masterImportSource.findFirstOrThrow({
    where: { sourceKey: fixture['Source Key'] },
  });
  if (stored.addressLine1 !== fixture['Address Line 1'])
    throw new Error('Correction conflict overwrote persisted values');
  await writeFile(
    path.join(runRoot, 'corrected-input.json'),
    JSON.stringify(
      {
        status: 'PASS',
        target: guarded.target,
        checksumRejected,
        staleRejected,
        initial: initial.rows[0],
        corrected: result.rows[0],
        conflict: conflict.rows[0],
        persistedId: stored.id,
        provenance,
      },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  console.log(
    'Controlled synthetic correction PASS: seal, stale token, create, conflict and provenance verified',
  );
}
main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Correction failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
