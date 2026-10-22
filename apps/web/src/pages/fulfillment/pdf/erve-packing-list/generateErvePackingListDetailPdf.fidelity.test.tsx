import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect, it } from 'vitest';
import { renderErvePackingListDetailPdfBlob as generateErvePackingListDetailPdfBlob } from './renderErvePackingListDetailPdf.js';
import { packingListFixture } from './ervePackingListPdf.test-utils.js';
import { verifyPackingListPdf } from './verifyErvePackingListPdf.test-utils.js';

// Stress is explicitly opt-in; these tests render and parse the production pipeline.
const boundedCases = [
  [0, 0, 0],
  [1, 1, 1],
  [4, 5, 6],
  [10, 5, 6],
  [11, 5, 6],
  [20, 5, 6],
  [21, 5, 10],
];
if (process.env.ERVE_PDF_STRESS === '1')
  boundedCases.push([12, 5, 10], [12, 15, 6], [12, 15, 10], [20, 15, 10]);
it.each(boundedCases)(
  'reconciles every rendered cell, total, provenance and page coordinate: %i x %i x %i',
  async (c, s, z) => {
    const source = packingListFixture(c, s, z);
    await verifyPackingListPdf(
      await generateErvePackingListDetailPdfBlob(source, { generatedAt: '2026-10-21T00:00:00Z' }),
      source,
    );
  },
  30000,
);

it.each([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])(
  'preserves size ordering and every group at %i sizes',
  async (sizes) => {
    const source = packingListFixture(1, 2, sizes);
    const output = await verifyPackingListPdf(
      await generateErvePackingListDetailPdfBlob(source, { generatedAt: '2026-10-21T00:00:00Z' }),
      source,
    );
    expect(output.text.some((t) => /^Sizes /.test(t))).toBe(sizes > 10);
  },
  15000,
);

it('preserves sparse/zero quantities, long style names and redacted provenance', async () => {
  const source = packingListFixture(11, 3, 11);
  for (const c of source.cartons) {
    delete c.factory;
    delete c.factoryDispatchNumber;
    c.lines = c.lines.filter((_l, i) => i !== 1 && i !== 13);
    c.lines[0]!.quantity = 0;
    for (const l of c.lines)
      l.styleName =
        'Premium cotton garment with reinforced seams and a deliberately long descriptive name for export packing verification';
    c.totalQuantity = c.lines.reduce((sum, l) => sum + l.quantity, 0);
  }
  delete source.sourceFactories;
  source.totalQuantity = source.cartons.reduce((sum, c) => sum + c.totalQuantity, 0);
  source.styleSizeSummary = source.cartons[0]!.lines.map((l, i) => ({
    ...l,
    quantity: source.cartons.reduce((sum, c) => sum + c.lines[i]!.quantity, 0),
  }));
  const output = await verifyPackingListPdf(
    await generateErvePackingListDetailPdfBlob(source, { generatedAt: '2026-10-21T00:00:00Z' }),
    source,
  );
  expect(output.text.join(' ')).not.toMatch(/Factory \d|FD\/\d|Source Factories/);
  expect(output.text.filter((t) => t === 'ST-001')).toHaveLength(24); // 11 cartons + summary, two column groups
}, 30000);

it('preserves a large single carton and its multipage consolidated summary', async () => {
  const source = packingListFixture(1, 75, 11);
  const output = await verifyPackingListPdf(
    await generateErvePackingListDetailPdfBlob(source, { generatedAt: '2026-10-21T00:00:00Z' }),
    source,
  );
  expect(output.pages).toBeGreaterThan(4);
}, 30000);

it('renders all twenty cartons including carton fourteen final row and column totals above the footer reserve', async () => {
  const source = packingListFixture(20, 5, 6);
  const blob = await generateErvePackingListDetailPdfBlob(source, {
    generatedAt: '2026-10-21T00:00:00Z',
  });
  const task = getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    useSystemFonts: true,
  });
  try {
    const doc = await task.promise;
    const text: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const items = (await (await doc.getPage(p)).getTextContent()).items.filter(
        (i) => 'str' in i && i.str.trim(),
      );
      for (const item of items) {
        if (!('str' in item)) continue;
        text.push(item.str);
        if (!/^Page \d+ of \d+$/.test(item.str))
          expect(item.transform[5], item.str).toBeGreaterThanOrEqual(40);
      }
      expect(
        items
          .filter((i) => 'str' in i && /^Page \d+ of \d+$/.test(i.str))
          .map((i) => ('str' in i ? i.str : '')),
      ).toEqual([`Page ${p} of ${doc.numPages}`]);
    }
    expect(text.filter((t) => t === 'Style / Size Summary')).toHaveLength(1);
    expect(text.filter((t) => /^Carton CTN-/.test(t))).toHaveLength(20);
    // Unique carton 14 / style 5 quantities, followed by its row total.
    for (const quantity of [14025, 14026, 14027, 14028, 14029, 14030, 84165])
      expect(text).toContain(String(quantity));
  } finally {
    await task.destroy();
  }
}, 30000);
