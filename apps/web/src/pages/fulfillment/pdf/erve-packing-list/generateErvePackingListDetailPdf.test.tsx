import { PDFDocument } from 'pdf-lib';
import { afterEach, expect, it, vi } from 'vitest';
import * as renderer from '../../../../lib/pdf/generate.js';
import { renderErvePackingListDetailPdfBlob as generateErvePackingListDetailPdfBlob } from './renderErvePackingListDetailPdf.js';
import { packingListFixture } from './ervePackingListPdf.test-utils.js';
import type { ErvePackingListDetailDocumentProps } from './ErvePackingListDetailDocument.js';

afterEach(() => vi.restoreAllMocks());

it.each([
  [0, [0]],
  [1, [1]],
  [9, [9]],
  [10, [10]],
  [11, [10, 1]],
  [20, [10, 10]],
  [21, [10, 10, 1]],
] as const)(
  'renders %i cartons sequentially with first/final context and returns every merged page',
  async (count, lengths) => {
    const source = packingListFixture(count, 1, 1);
    let active = false;
    const batches: ErvePackingListDetailDocumentProps[] = [];
    vi.spyOn(renderer, 'renderPdfBlob').mockImplementation(async (element) => {
      expect(active, 'overlapping batch render').toBe(false);
      active = true;
      batches.push(element.props as ErvePackingListDetailDocumentProps);
      const doc = await PDFDocument.create();
      doc.addPage([841.89, 595.28]);
      const bytes = await doc.save();
      active = false;
      return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
    });
    const blob = await generateErvePackingListDetailPdfBlob(source, {
      generatedAt: '2026-10-21T00:00:00Z',
    });
    expect(batches.map((b) => b.viewModel.cartons.length)).toEqual(lengths);
    expect(batches.flatMap((b) => b.viewModel.cartons.map((c) => c.id))).toEqual(
      source.cartons.map((c) => c.id),
    );
    expect(batches.map((b) => b.first)).toEqual(lengths.map((_l, i) => i === 0));
    expect(batches.map((b) => b.last)).toEqual(lengths.map((_l, i) => i === lengths.length - 1));
    expect((await PDFDocument.load(await blob.arrayBuffer())).getPageCount()).toBe(lengths.length);
    expect(blob.type).toBe('application/pdf');
  },
);

it('rejects a failed intermediate batch without starting the remaining batches or returning a partial PDF', async () => {
  let calls = 0;
  vi.spyOn(renderer, 'renderPdfBlob').mockImplementation(async () => {
    calls++;
    if (calls === 2) throw new Error('Synthetic render failure');
    const doc = await PDFDocument.create();
    doc.addPage();
    return new Blob([new Uint8Array(await doc.save())]);
  });
  await expect(
    generateErvePackingListDetailPdfBlob(packingListFixture(21, 1, 1), {
      generatedAt: '2026-10-21T00:00:00Z',
    }),
  ).rejects.toThrow('Synthetic render failure');
  expect(calls).toBe(2);
});

it('rejects malformed batch bytes instead of returning the previously merged pages', async () => {
  vi.spyOn(renderer, 'renderPdfBlob').mockResolvedValue(new Blob(['invalid PDF']));
  await expect(
    generateErvePackingListDetailPdfBlob(packingListFixture(1, 1, 1), {
      generatedAt: '2026-10-21T00:00:00Z',
    }),
  ).rejects.toThrow();
});
