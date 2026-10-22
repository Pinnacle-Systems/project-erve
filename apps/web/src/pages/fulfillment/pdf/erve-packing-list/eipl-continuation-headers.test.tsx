import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect, it } from 'vitest';
import type { ErvePackingListDetail } from '../../types.js';
import { packingListFixture } from './ervePackingListPdf.test-utils.js';
import { renderErvePackingListDetailPdfBlob } from './renderErvePackingListDetailPdf.js';
import { verifyPackingListPdf } from './verifyErvePackingListPdf.test-utils.js';

async function verify(source: ErvePackingListDetail, name: string) {
  const blob = await renderErvePackingListDetailPdfBlob(source, {
    generatedAt: '2026-10-22T10:00:00Z',
    generatedBy: 'Synthetic QA',
  });
  const output = process.env.ISS044_PDF_EVIDENCE_DIR;
  if (output) {
    await mkdir(output, { recursive: true });
    await writeFile(resolve(output, `${name}.pdf`), new Uint8Array(await blob.arrayBuffer()));
    const task = getDocument({
      data: new Uint8Array(await blob.arrayBuffer()),
      useSystemFonts: true,
    });
    try {
      const doc = await task.promise;
      const pages = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        pages.push({
          page: p,
          items: (await page.getTextContent()).items.flatMap((item) =>
            'str' in item
              ? [
                  {
                    text: item.str,
                    x: item.transform[4],
                    y: item.transform[5],
                    width: item.width,
                    height: item.height,
                  },
                ]
              : [],
          ),
        });
      }
      await writeFile(resolve(output, `${name}.json`), JSON.stringify(pages, null, 2));
    } finally {
      await task.destroy();
    }
  }
  const result = await verifyPackingListPdf(blob, source);
  if (output)
    await writeFile(resolve(output, `${name}-acceptance.json`), JSON.stringify(result, null, 2));
  return result;
}

// Removing page-aware headers must fail these actual-byte checks, including ST-011
// in the summary continuation. Neighboring counts exercise changes in physical breaks.
it.each([1, 2, 7, 8, 9, 10, 11, 12, 13, 14])(
  'maps Size headers on every physical page (%i styles)',
  async (count) => {
    const result = await verify(packingListFixture(1, count, 3), `styles-${count}`);
    if (count === 2) expect(result.pages).toBe(1); // no trailing-margin artifact page
    if (count === 11) {
      const summary = result.headers.filter((h) => h.section === 'summary');
      expect(summary.length).toBeGreaterThan(1);
      expect(summary.at(-1)!.rows).toContain('ST-011');
      expect(summary.at(-1)!.sizes).toEqual(['SZ1', 'SZ2', 'SZ3']);
    }
  },
  30000,
);

it.each(['short', 'long', 'mixed'] as const)(
  'isolates carton and summary groups with %s row heights',
  async (mode) => {
    const source = packingListFixture(3, 35, 23);
    for (const line of [...source.cartons.flatMap((c) => c.lines), ...source.styleSizeSummary]) {
      if (mode === 'long' || (mode === 'mixed' && Number(line.styleNumber.slice(3)) % 3 === 0)) {
        line.styleName =
          'Premium cotton garment with reinforced seams and a deliberately long descriptive name for export packing verification';
      }
    }
    const result = await verify(source, `wide-${mode}`);
    for (const section of ['CTN-001', 'CTN-002', 'CTN-003', 'summary']) {
      for (const group of [0, 1, 2]) {
        const headers = result.headers.filter((h) => h.section === section && h.group === group);
        expect(headers.length, `${section}/${group} spans physical pages`).toBeGreaterThan(1);
        for (const header of headers) {
          expect(header.sizes).toEqual(
            Array.from({ length: group === 2 ? 3 : 10 }, (_, n) => `SZ${group * 10 + n + 1}`),
          );
        }
      }
    }
  },
  60000,
);

it('covers summary starting on a fresh page and near a page end', async () => {
  const results = [];
  for (const count of [3, 5, 6])
    results.push(await verify(packingListFixture(1, count, 3), `summary-${count}`));
  const firstHeaders = results.map((r) => r.headers.find((h) => h.section === 'summary')!);
  expect(firstHeaders.some((h) => h.y > 480)).toBe(true);
  expect(firstHeaders.some((h) => h.y < 200)).toBe(true);
}, 30000);

it('keeps heterogeneous carton Size sets separate from their summary union', async () => {
  const source = packingListFixture(2, 24, 11);
  for (const [index, carton] of source.cartons.entries()) {
    for (const line of carton.lines) {
      line.sizeCode = `${index === 0 ? 'A' : 'B'}${line.sizeCode.slice(2).padStart(2, '0')}`;
      line.sizeLabel = line.sizeCode;
    }
  }
  source.styleSizeSummary = source.cartons.flatMap((c) => c.lines);
  const result = await verify(source, 'heterogeneous');
  for (const h of result.headers) {
    if (h.section === 'CTN-001') expect(h.sizes.every((size) => size.startsWith('A'))).toBe(true);
    if (h.section === 'CTN-002') expect(h.sizes.every((size) => size.startsWith('B'))).toBe(true);
  }
  expect(
    result.headers
      .filter((h) => h.section === 'summary')
      .some(
        (h) => h.sizes.some((s) => s.startsWith('A')) && h.sizes.some((s) => s.startsWith('B')),
      ),
  ).toBe(true);
}, 30000);
