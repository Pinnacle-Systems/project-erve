// Step 2: populate the CURRENT import templates (fetched live from GET /master-imports/:kind/template and
// GET /styles/bulk-import/template) from the extracted AW26 data. Never reuses an old generated import file.
//
//   cd apps/api && AW26_WORKSPACE=<external dir> AW26_SOURCES=<project-erve-artifacts dir> \
//     npx tsx ../../tools/aw26-post-dispatch-verification/build-import-workbooks.mts
//
// All output stays in the external workspace (customer-derived; never commit it).
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { extractNormalizedEmbeddedImagesByRow } from '../../apps/api/src/cli/xlsx-embedded-images.js';

const require = createRequire(path.resolve(import.meta.dirname, '../../apps/api/package.json'));
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');

const WS = process.env.AW26_WORKSPACE;
const cfg = JSON.parse(readFileSync(path.join(WS!, 'scenario-config.json'), 'utf8'));
const SRC = process.env.AW26_SOURCES;
if (!WS || !SRC) throw new Error('AW26_WORKSPACE and AW26_SOURCES are required');
const TEMPLATES = path.join(WS, '01-current-import-templates');
const EXTRACTED = path.join(WS, '02-aw26-extracted-data');
const OUT = path.join(WS, '04-import-ready');
mkdirSync(path.join(EXTRACTED, 'images'), { recursive: true });
mkdirSync(OUT, { recursive: true });

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
type Row = Record<string, string>;
function csv(name: string): Row[] {
  const wb = XLSX.read(readFileSync(path.join(EXTRACTED, name), 'utf8').replace(/^﻿/, ''), {
    type: 'string',
    raw: true,
  });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false }) as Row[];
}

async function fill(
  templateFile: string,
  sheet: string,
  rows: Record<string, string | number>[],
  outName: string,
  images?: Map<number, Buffer>,
) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(TEMPLATES, templateFile));
  const ws = wb.getWorksheet(sheet);
  const header: string[] = [];
  ws.getRow(1).eachCell(
    { includeEmpty: false },
    (cell: { value: unknown }, col: number) => (header[col] = String(cell.value)),
  );
  rows.forEach((record, index) => {
    const row = ws.getRow(index + 2);
    for (const [key, value] of Object.entries(record)) {
      const col = header.indexOf(key);
      if (col < 1)
        throw new Error(
          `${templateFile}: template has no column "${key}" (current columns: ${header.filter(Boolean).join(', ')})`,
        );
      const cell = row.getCell(col);
      cell.value = typeof value === 'number' ? value : String(value);
      if (typeof value !== 'number') cell.numFmt = '@';
    }
    row.commit();
  });
  if (images) {
    const imageColumn = header.length; // first free column after the template's own columns
    rows.forEach((_, index) => {
      const png = images.get(index);
      if (!png) return;
      const id = wb.addImage({ buffer: png, extension: 'png' });
      ws.addImage(id, { tl: { col: imageColumn, row: index + 1 }, ext: { width: 80, height: 80 } });
      ws.getRow(index + 2).height = 62;
    });
  }
  await wb.xlsx.writeFile(path.join(OUT, outName));
  const bytes = readFileSync(path.join(OUT, outName));
  return { file: outName, rows: rows.length, bytes: bytes.length, sha256: sha(bytes) };
}

const manifest: unknown[] = [];

// ---- Season: Barcode Serial 3 is evidenced by the real AW26 barcodes (every one starts "3"+LMIX digits)
manifest.push(
  await fill(
    'seasons-template.xlsx',
    'Seasons',
    [{ 'Season Code': 'AW26', 'Season Name': 'AW26', 'Barcode Serial': 3, Status: 'ACTIVE' }],
    '01-seasons.xlsx',
  ),
);

// ---- Sizes 3..14 (AW26 native size sets are 3-8 and 9-14)
manifest.push(
  await fill(
    'sizes-template.xlsx',
    'Sizes',
    Array.from({ length: 12 }, (_, i) => ({
      'Size Code': String(i + 3),
      'Size Label': `${i + 3} Years`,
      'Size Type': 'AGE',
      'Sort Order': i + 3,
      Status: 'ACTIVE',
    })),
    '02-sizes.xlsx',
  ),
);

// ---- HSN
const hsn = csv('hsn-candidates.csv');
manifest.push(
  await fill(
    'hsns-template.xlsx',
    'HSNs',
    hsn.map((h) => ({
      'HSN Code': h['HSN Code'],
      Description: h['Description'],
      Status: 'ACTIVE',
    })),
    '03-hsns.xlsx',
  ),
);

// ---- Factories (name only: no address/contact exists in any source)
const factories = csv('factories-selection.csv').filter((f) => f['Decision'] === 'SELECTED');
manifest.push(
  await fill(
    'factories-template.xlsx',
    'Factories',
    factories.map((f) => ({ Name: f['Name'] })),
    '04-factories.xlsx',
  ),
);

// ---- Distributors: faithful (Purchase Mode blank -> NEEDS_REVIEW) and TEST ONLY overlay
const selection = csv('distributors-selection.csv').filter((d) => d['Decision'] === 'SELECTED');
const structured = csv('distributors-structured.csv');
const byName = new Map(structured.map((d) => [d['name'], d]));
const distributorRows = (withMode: boolean) =>
  selection.map((s) => {
    const d = byName.get(s['Name'])!;
    return {
      Name: s['Name'],
      GSTIN: s['GSTIN'],
      'Purchase Mode': withMode
        ? s['Purchase Mode in OLD package (TEST DATA, not business-confirmed)']
        : '',
      'Address Line 1': d['line1'],
      'Address Line 2': d['line2'],
      City: d['city'],
      State: d['state'],
      Country: d['country'],
      'Postal Code': d['pin'],
      Phone: d['phone'],
    };
  });
manifest.push(
  await fill(
    'distributors-template.xlsx',
    'Distributors',
    distributorRows(false),
    '05-distributors-faithful.xlsx',
  ),
);
manifest.push(
  await fill(
    'distributors-template.xlsx',
    'Distributors',
    distributorRows(true),
    '05b-distributors-TEST-ONLY-purchase-mode.xlsx',
  ),
);

// ---- Retail Stores
const storeRow = (s: Row) => ({
  'Distributor Name': s['parent'],
  'Distributor GSTIN': s['parent_gstin'],
  'Distributor Purchase Mode': '',
  Name: s['name'],
  'Address Line 1': s['line1'],
  'Address Line 2': s['line2'],
  City: s['city'],
  State: s['state'],
  Country: s['country'],
  'Postal Code': s['pin'],
  Phone: s['phone'],
  Email: s['email'],
  GSTIN: s['gstin'],
});
manifest.push(
  await fill(
    'retail-stores-template.xlsx',
    'Retail stores',
    csv('retail-stores-import-candidates.csv').map(storeRow),
    '06-retail-stores.xlsx',
  ),
);
manifest.push(
  await fill(
    'retail-stores-template.xlsx',
    'Retail stores',
    csv('retail-stores-review-queue.csv').map(storeRow),
    '06c-retail-stores-REVIEW-QUEUE-not-imported.xlsx',
  ),
);
const outrightDist = byName.get(cfg.dist.B)!;
manifest.push(
  await fill(
    'retail-stores-template.xlsx',
    'Retail stores',
    [
      {
        'Distributor Name': cfg.dist.B,
        'Distributor GSTIN': outrightDist['gstin'],
        'Distributor Purchase Mode': '',
        Name: cfg.store.B1,
        'Address Line 1': outrightDist['line1'],
        City: outrightDist['city'],
        State: outrightDist['state'],
        Country: outrightDist['country'],
        'Postal Code': outrightDist['pin'],
      },
    ],
    '06b-retail-stores-TEST-ONLY-placeholder.xlsx',
  ),
);

// ---- Style images: authoritative source = AW26 - Dashboard.xlsx (Modern picture-in-cell), rows 94-108
const dashboard = readFileSync(path.join(SRC, 'erve_historical_data', 'AW26 - Dashboard.xlsx'));
const dash = await extractNormalizedEmbeddedImagesByRow(dashboard, 'MRP & Ex Factory');
const reconciled = readFileSync(
  path.join(SRC, 'erve-prod-master-import', '20261025-season-reconciled', 'AW26_Styles.xlsx'),
);
const rec = await extractNormalizedEmbeddedImagesByRow(reconciled, 'Styles');
const styles = csv('aw26-styles-selected.csv');
const imageRows: string[][] = [
  [
    'Style Number',
    'Dashboard row',
    'Dashboard image sha256',
    'Bytes',
    'Reconciled-package image sha256',
    'Same bytes as reconciled package',
  ],
];
const imageFor = new Map<string, Buffer>();
for (const style of styles) {
  const dashRow = Number(/row (\d+)/.exec(style['Source row (Dashboard)'])![1]);
  const recRow = Number(/row (\d+)/.exec(style['Source row (reconciled styles)'])![1]);
  const images = dash.imagesByRow.get(dashRow) ?? [];
  if (images.length !== 1)
    throw new Error(
      `${style['Style Number']}: expected exactly one Dashboard image on row ${dashRow}, got ${images.length}`,
    );
  const other = rec.imagesByRow.get(recRow)?.[0];
  imageFor.set(style['Style Number'], images[0]!.buffer);
  writeFileSync(path.join(EXTRACTED, 'images', `${style['Style Number']}.png`), images[0]!.buffer);
  imageRows.push([
    style['Style Number'],
    String(dashRow),
    sha(images[0]!.buffer),
    String(images[0]!.buffer.length),
    other ? sha(other.buffer) : '(none)',
    String(other ? sha(other.buffer) === sha(images[0]!.buffer) : false),
  ]);
}
writeFileSync(
  path.join(EXTRACTED, 'images-manifest.csv'),
  imageRows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n'),
);

// ---- Styles (current template; Royalty % has no source and stays blank)
const styleRow = (s: Row) => ({
  'Style Number': s['Style Number'],
  'Style Name': s['Style Name'],
  'Final MRP': s['Final MRP'] === '' ? '' : Number(s['Final MRP']),
  'Season Code': s['Season Code'],
  'Size Codes': s['Size Codes'],
  'LMIX Number': s['LMIX Number'],
  'HSN Code': s['HSN Code (invoice-evidenced only)'],
  'Factory Name Mappings': s['Factory Name Mappings'],
  Category: s['Category'],
  'IP Name': s['IP Name'],
  Licensor: s['Licensor'],
  Colour: s['Colour'],
});
const importable = styles.filter((s) => s['Decision'] === 'IMPORT');
const review = styles.filter((s) => s['Decision'] !== 'IMPORT');
manifest.push(
  await fill(
    'styles-template.xlsx',
    'Styles',
    importable.map(styleRow),
    '07-styles-AW26.xlsx',
    new Map(importable.map((s, i) => [i, imageFor.get(s['Style Number'])!])),
  ),
);
manifest.push(
  await fill(
    'styles-template.xlsx',
    'Styles',
    review.map(styleRow),
    '07c-styles-NEEDS-REVIEW-not-imported.xlsx',
    new Map(review.map((s, i) => [i, imageFor.get(s['Style Number'])!])),
  ),
);

writeFileSync(path.join(OUT, 'build-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 1));
