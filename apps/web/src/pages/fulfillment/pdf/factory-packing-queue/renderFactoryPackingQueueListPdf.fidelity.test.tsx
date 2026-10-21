import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect, it } from 'vitest';
import { renderFactoryPackingQueueListPdfBlob } from './renderFactoryPackingQueueListPdf.js';
import type { FactoryPackingQueueListPdfViewModel } from './buildFactoryPackingQueueListViewModel.js';

function fixture(awaiting: number, dispatches: number): FactoryPackingQueueListPdfViewModel {
  return {
    title: 'FACTORY PACKING QUEUE',
    subtitle: 'Synthetic authorized queue',
    generatedAt: '2026-10-22T00:00:00Z',
    generatedBy: 'Queue fidelity test',
    awaitingPackingCount: awaiting,
    awaitingPacking: Array.from({ length: awaiting }, (_, i) => ({
      id: `line-${i}`,
      saleOrderNumber: `EISO/${i}`,
      distributorName: `Distributor ${i}`,
      styleDisplay: `ST-${i} / Queue fixture`,
      sizeLabel: `Size ${i % 10}`,
      allocatedQuantity: 1000 + i,
      packedQuantity: 100 + (i % 20),
      remainingQuantity: 900 + i - (i % 20),
    })),
    factoryDispatchCount: dispatches,
    factoryDispatches: Array.from({ length: dispatches }, (_, i) => ({
      id: `dispatch-${i}`,
      factoryDispatchNumber: `EIFD/${i}`,
      saleOrderNumber: `EISO/${i}`,
      distributorsDisplay: `Destination ${i}`,
      statusLabel: i % 2 ? 'Ready for Erve' : 'Draft',
      consolidated: i % 2 ? 'Yes' : '—',
    })),
  };
}

const cases = [
  [0, 0],
  [1, 1],
  [80, 80],
];
if (process.env.QUEUE_PDF_STRESS === '1') cases.push([320, 160]);

it.each(cases)(
  'preserves every rendered field, source row order, count and global footer: %i awaiting / %i dispatches',
  async (a, d) => {
    const source = fixture(a, d);
    const blob = await renderFactoryPackingQueueListPdfBlob(source);
    expect(blob.type).toBe('application/pdf');
    const task = getDocument({
      data: new Uint8Array(await blob.arrayBuffer()),
      useSystemFonts: true,
    });
    try {
      const doc = await task.promise;
      const text: string[] = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const items = (await page.getTextContent()).items.filter((i) => 'str' in i && i.str.trim());
        const footers: string[] = [];
        for (const item of items) {
          if (!('str' in item)) continue;
          text.push(item.str);
          if (/^Page \d+ of \d+$/.test(item.str)) footers.push(item.str);
          else expect(item.transform[5], `${item.str} footer reserve`).toBeGreaterThanOrEqual(39.5);
          expect(item.transform[4]).toBeGreaterThanOrEqual(27.5);
          expect(item.transform[4]! + item.width).toBeLessThanOrEqual(page.view[2]! - 27.5);
        }
        expect(footers).toEqual([`Page ${p} of ${doc.numPages}`]);
        expect(items.some((i) => 'str' in i && i.str === source.title)).toBe(true);
        const ops = await page.getOperatorList();
        expect(
          ops.fnArray.some((n) =>
            [
              OPS.paintImageXObject,
              OPS.paintInlineImageXObject,
              OPS.paintImageXObjectRepeat,
            ].includes(n),
          ),
        ).toBe(true);
      }
      for (const label of [`Awaiting Packing (${a})`, `Your Factory Dispatches (${d})`])
        expect(text.filter((s) => s === label)).toHaveLength(1);
      let lastAwaiting = -1;
      for (const row of source.awaitingPacking) {
        const index = text.indexOf(row.styleDisplay);
        expect(text.filter((s) => s === row.styleDisplay)).toHaveLength(1);
        expect(index).toBeGreaterThan(lastAwaiting);
        lastAwaiting = index;
        expect(text.slice(index - 2, index + 5)).toEqual([
          row.saleOrderNumber,
          row.distributorName,
          row.styleDisplay,
          row.sizeLabel,
          String(row.allocatedQuantity),
          String(row.packedQuantity),
          String(row.remainingQuantity),
        ]);
      }
      let lastDispatch = lastAwaiting;
      for (const row of source.factoryDispatches) {
        const index = text.indexOf(row.factoryDispatchNumber);
        expect(text.filter((s) => s === row.factoryDispatchNumber)).toHaveLength(1);
        expect(index).toBeGreaterThan(lastDispatch);
        lastDispatch = index;
        expect(text.slice(index, index + 5)).toEqual([
          row.factoryDispatchNumber,
          row.saleOrderNumber,
          row.distributorsDisplay,
          row.statusLabel,
          row.consolidated,
        ]);
      }
    } finally {
      await task.destroy();
    }
  },
  20000,
);
