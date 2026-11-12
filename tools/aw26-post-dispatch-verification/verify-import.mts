// Gate 1 verification: compares what the importers actually created against the ORIGINAL sources.
//   cd apps/api && AW26_WORKSPACE=... AW26_SOURCES=... npx tsx ../../tools/aw26-post-dispatch-verification/verify-import.mts
// Reads the disposable database named by apps/api/.env (refuses unless its name has a standalone "test" marker).
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '../../apps/api/src/db/prisma.js';
import { requireSafeTestDatabaseUrl } from '../../apps/api/src/test/database-safety.js';

requireSafeTestDatabaseUrl({ testDatabaseUrl: process.env.DATABASE_URL });
const require = createRequire(path.resolve(import.meta.dirname, '../../apps/api/package.json'));
const XLSX = require('xlsx');
const WS = process.env.AW26_WORKSPACE!;
const cfg = JSON.parse(readFileSync(path.join(WS, 'scenario-config.json'), 'utf8'));
const SRC = process.env.AW26_SOURCES!;
const storage = process.env.FILE_STORAGE_DIR!;
const csv = (name: string) => {
  const wb = XLSX.read(
    readFileSync(path.join(WS, '02-aw26-extracted-data', name), 'utf8').replace(/^﻿/, ''),
    { type: 'string', raw: true },
  );
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    defval: '',
    raw: false,
  }) as Record<string, string>[];
};
const info: Record<string, string>[] = [];
const checks: { id: string; area: string; expected: string; actual: string; pass: boolean }[] = [];
const check = (id: string, area: string, expected: unknown, actual: unknown) =>
  checks.push({
    id,
    area,
    expected: String(expected),
    actual: String(actual),
    pass: String(expected) === String(actual),
  });

// ---- Season
const season = await prisma.season.findFirstOrThrow({ where: { code: 'AW26' } });
check('S1', 'AW26 Season exists with Barcode Serial 3', 3, season.barcodeSerial);
// ---- Styles vs extraction
const selected = csv('aw26-styles-selected.csv');
const imported = selected.filter((s) => s['Decision'] === 'IMPORT');
const styles = await prisma.style.findMany({
  where: { seasonId: season.id },
  include: {
    styleSizes: { include: { size: true } },
    images: { include: { file: true } },
    styleFactoryMappings: { include: { factory: true } },
    hsn: true,
  },
});
check('ST1', 'Styles created in AW26 == importable selected', imported.length, styles.length);
check(
  'ST2',
  'NEEDS_REVIEW Styles are absent',
  0,
  styles.filter((s) =>
    selected.some((x) => x['Decision'] !== 'IMPORT' && x['Style Number'] === s.styleNumber),
  ).length,
);
const book = csv('aw26-style-size-barcodes-source.csv');
for (const row of imported) {
  const style = styles.find((s) => s.styleNumber === row['Style Number']);
  if (!style) {
    check(`ST-${row['Style Number']}`, 'exists', 'present', 'MISSING');
    continue;
  }
  const n = row['Style Number'];
  check(`${n}:mrp`, 'Final MRP', Number(row['Final MRP']), Number(style.finalMrp));
  check(`${n}:season`, 'Season association', 'AW26', season.code);
  const sizes = style.styleSizes
    .map((s) => s.size.code)
    .sort((a, b) => Number(a) - Number(b))
    .join(',');
  check(`${n}:sizes`, 'Native Style x Size set == source', row['Size Codes'], sizes);
  // The app's generator (barcode.util.ts) uses "<serial> <LMIX digits><size padded to 2>" for Season serial 3+.
  const lmix = row['LMIX Number'].replace(/^LMIX/i, '');
  const expectedGenerated = style.styleSizes
    .slice()
    .sort((a, b) => Number(a.size.code) - Number(b.size.code))
    .map((s) => `${s.size.code}:3 ${lmix}${s.size.code.padStart(2, '0')}`)
    .join(',');
  const generated = style.styleSizes
    .slice()
    .sort((a, b) => Number(a.size.code) - Number(b.size.code))
    .map((s) => `${s.size.code}:${s.barcode}`)
    .join(',');
  check(
    `${n}:barcodes`,
    'Barcodes follow the documented Season 3+ generator format',
    expectedGenerated,
    generated,
  );
  // Informational: the legacy Book1.xlsx barcodes use the OLD concatenation (no space / no padding).
  const sourceBarcodes = book
    .filter((b) => b['Style Number'] === n)
    .sort((a, b) => Number(a['Size Code (derived)']) - Number(b['Size Code (derived)']))
    .map((b) => `${b['Size Code (derived)']}:${b['Source barcode']}`)
    .join(',');
  info.push({
    id: `${n}:barcode-vs-Book1`,
    note: 'Book1.xlsx legacy barcode differs from the app-generated Season 3+ barcode',
    book1: sourceBarcodes,
    generated,
  });
  check(
    `${n}:factory`,
    'Factory mapping (Rahaa + ex-factory price)',
    row['Factory Name Mappings'],
    style.styleFactoryMappings
      .map((m) => `${m.factory.name}:${Number(m.exFactoryPrice)}`)
      .join(';'),
  );
  check(
    `${n}:hsn`,
    'HSN (only invoice-evidenced)',
    row['HSN Code (invoice-evidenced only)'],
    style.hsn?.code ?? '',
  );
  const imageManifest = csv('images-manifest.csv').find((r) => r['Style Number'] === n)!;
  const stored = style.images[0];
  const storedHash = stored
    ? createHash('sha256')
        .update(readFileSync(path.join(storage, stored.file.storageKey)))
        .digest('hex')
    : '(none)';
  check(
    `${n}:image`,
    'Stored primary image bytes == Dashboard source image',
    imageManifest['Dashboard image sha256'],
    storedHash,
  );
  check(
    `${n}:meta`,
    'Colour/IP/Licensor',
    `${row['Colour']}|${row['IP Name']}|${row['Licensor']}`,
    `${style.colour}|${style.ipName}|${style.licensor}`,
  );
}
// ---- Masters
const distributors = await prisma.distributor.findMany();
check('D1', 'Distributors created == selected', 12, distributors.length);
const structured = csv('distributors-structured.csv');
for (const d of structured) {
  const row = distributors.find((x) => x.gstin === d['gstin'] && x.name === d['name']);
  if (!row) {
    check(`D-${d['name']}`, 'exists', 'present', 'MISSING');
    continue;
  }
  check(
    `D-${d['name']}:addr`,
    'Distributor structured address',
    `${d['line1']}|${d['city']}|${d['state']}|${d['pin']}`,
    `${row.addressLine1}|${row.city ?? ''}|${row.state ?? ''}|${row.postalCode ?? ''}`,
  );
}
const stores = await prisma.retailStore.findMany({ include: { distributor: true } });
const candidates = csv('retail-stores-import-candidates.csv');
check('R1', 'Retail Stores: 30 real + 1 TEST ONLY placeholder', 31, stores.length);
check(
  'R2',
  'Review-queue stores NOT created',
  0,
  stores.filter((s) =>
    (cfg.queuedStores as string[]).some((q) => q.toLowerCase() === s.name.toLowerCase()),
  ).length,
);
let addressMismatch = 0,
  nbsp = 0,
  gstinKept = 0;
for (const c of candidates) {
  const s = stores.find(
    (x) =>
      x.name === c['name'] &&
      x.postalCode === c['pin'] &&
      x.distributor.name === c['parent'] &&
      x.addressLine1 === c['line1'],
  );
  if (!s) {
    addressMismatch++;
    console.log('NOT FOUND', c['name']);
    continue;
  }
  if (
    `${s.addressLine1}|${s.city}|${s.state}|${s.country}` !==
    `${c['line1']}|${c['city']}|${c['state']}|${c['country']}`
  ) {
    addressMismatch++;
    console.log(
      'ADDR DIFF',
      JSON.stringify([
        c['name'],
        s.addressLine1,
        c['line1'],
        s.city,
        c['city'],
        s.state,
        c['state'],
      ]),
    );
  }
  if (/ /.test(`${s.name}${s.city}${s.addressLine1}`)) nbsp++;
  if ((s.gstin ?? '') === c['gstin']) gstinKept++;
}
check('R3', 'Every imported Store matches its structured source address', 0, addressMismatch);
check('R4', 'No NBSP left in names/cities/addresses', 0, nbsp);
check('R5', 'Store GSTIN preserved from source', candidates.length, gstinKept);
check(
  'R6',
  'Store address contains no duplicated state/PIN text in Line 1',
  0,
  stores.filter((s) => s.addressLine1.includes(s.postalCode)).length,
);
const factories = await prisma.factory.findMany();
check('F1', 'Factories: Rahaa + second Factory only', 2, factories.length);
check(
  'M1',
  'Distributor Purchase Mode present only via the TEST ONLY overlay (counts OUTRIGHT/SALE_RETURN)',
  '2/10',
  `${distributors.filter((d) => d.purchaseMode === 'OUTRIGHT').length}/${distributors.filter((d) => d.purchaseMode === 'SALE_RETURN').length}`,
);
writeFileSync(
  path.join(WS, '05-preflight-results', 'import-verification.json'),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      passed: checks.filter((c) => c.pass).length,
      failed: checks.filter((c) => !c.pass).length,
      informationalDiscrepancies: info,
      checks,
    },
    null,
    2,
  ),
);
console.log(
  `${checks.filter((c) => c.pass).length} passed, ${checks.filter((c) => !c.pass).length} failed`,
);
for (const c of checks.filter((c) => !c.pass))
  console.log(
    'FAIL',
    c.id,
    c.area,
    '\n  expected',
    c.expected.slice(0, 200),
    '\n  actual  ',
    c.actual.slice(0, 200),
  );
await prisma.$disconnect();
