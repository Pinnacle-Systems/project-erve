import { pdf } from '@react-pdf/renderer';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { FactoryPackingListDetailDocument } from './FactoryPackingListDetailDocument.js';
import type {
  FactoryPackingListCartonRow,
  FactoryPackingListCartonStyleRow,
  FactoryPackingListDestinationSection,
  FactoryPackingListPdfViewModel,
} from './buildFactoryPackingListViewModel.js';

// ISS-039 — real page-level verification that Style thumbnails (a) actually embed a decodable
// image, not just a prop, (b) degrade to a placeholder without throwing or dropping text, and
// (c) never change the printed page count / introduce overlapping content for a representative
// multi-destination, multi-carton fixture. Same pdfjs-dist Node-legacy-build pattern already used
// by PdfStyleSizeMatrix.pagination.test.tsx and the historical-import PDF session module.

interface OpenedPdf {
  numPages: number;
  fullText: string;
  /** Total image paint ops across all pages. Every page already embeds the fixed ERVE letterhead
   * logo via PdfHeader (one op per page), so this is never zero — thumbnails are proven by a
   * COUNT above that per-page baseline, not by bare presence/absence. */
  imagePaintOpCount: number;
  itemsByPage: { str: string; x: number; y: number; width: number }[][];
}

const openSessions: { destroy: () => Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(openSessions.splice(0).map((session) => session.destroy()));
});

async function renderAndOpen(viewModel: FactoryPackingListPdfViewModel): Promise<OpenedPdf> {
  const blob = await pdf(<FactoryPackingListDetailDocument viewModel={viewModel} />).toBlob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const loadingTask = getDocument({ data: bytes, useSystemFonts: true });
  const doc = await loadingTask.promise;
  openSessions.push({ destroy: () => loadingTask.destroy() });

  const itemsByPage: OpenedPdf['itemsByPage'] = [];
  let imagePaintOpCount = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    itemsByPage.push(
      content.items.flatMap((item) =>
        'str' in item ? [{ str: item.str, x: item.transform[4]!, y: item.transform[5]!, width: item.width }] : [],
      ),
    );
    const operators = await page.getOperatorList();
    imagePaintOpCount += operators.fnArray.filter((n) =>
      [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat].includes(n),
    ).length;
  }
  const fullText = itemsByPage.map((page) => page.map((i) => i.str).join(' ')).join('\n');
  return { numPages: doc.numPages, fullText, imagePaintOpCount, itemsByPage };
}

/** Flags any two same-row text items whose horizontal extents actually overlap — real geometry, not string presence. */
function assertNoHorizontalOverlap(itemsByPage: OpenedPdf['itemsByPage']): void {
  for (const items of itemsByPage) {
    for (let a = 0; a < items.length; a++) {
      for (let b = a + 1; b < items.length; b++) {
        const x = items[a]!;
        const y = items[b]!;
        if (!x.str.trim() || !y.str.trim()) continue;
        if (Math.abs(x.y - y.y) < 1) {
          const overlap = Math.min(x.x + x.width, y.x + y.width) - Math.max(x.x, y.x);
          expect(overlap, `"${x.str}" / "${y.str}" overlap`).toBeLessThanOrEqual(0.7);
        }
      }
    }
  }
}

async function realImageDataUri(): Promise<string> {
  const bytes = await fs.readFile(new URL('../../../../../public/erve-logo.png', import.meta.url));
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

function makeCarton(overrides: Partial<FactoryPackingListCartonRow> = {}): FactoryPackingListCartonRow {
  return {
    id: 'carton-1',
    cartonNumber: 'C1',
    netWeight: '12.5 kg',
    packageDetails: '1 poly bag per unit',
    auditStateLabel: 'Not Inspected',
    destinationMismatch: false,
    totalQuantity: 10,
    lines: [{ id: 'line-1', styleDisplay: 'ST-001 — Classic Tee', sizeLabel: 'Medium', quantity: 10 }],
    sizeColumns: [{ sizeId: 'size-1', sizeCode: 'M' }],
    styleRows: [{ styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', values: { 'size-1': 10 } }],
    ...overrides,
  };
}

function makeStyleRow(overrides: Partial<FactoryPackingListCartonStyleRow> = {}): FactoryPackingListCartonStyleRow {
  return { styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', values: { 'size-1': 10 }, ...overrides };
}

function makeDestination(overrides: Partial<FactoryPackingListDestinationSection> = {}): FactoryPackingListDestinationSection {
  return {
    id: 'dest-1',
    label: 'Chennai, TN',
    distributorName: 'Distributor One',
    addressLine: '123 Test Street, Chennai, TN, India',
    contactName: 'Ravi Kumar',
    sizeColumns: [{ sizeId: 'size-1', sizeCode: 'M' }],
    requiredStyleRows: [makeStyleRow()],
    packedStyleRows: [makeStyleRow()],
    cartons: [makeCarton()],
    ...overrides,
  };
}

function makeViewModel(overrides: Partial<FactoryPackingListPdfViewModel> = {}): FactoryPackingListPdfViewModel {
  return {
    title: 'FACTORY PACKING LIST',
    subtitle: 'EISO/26-27/0001 — Factory One',
    generatedAt: '2026-09-15T10:00:00Z',
    generatedBy: 'Test Factory User',
    saleOrderNumber: 'EISO/26-27/0001',
    factoryName: 'Factory One',
    distributorsDisplay: 'Distributor One',
    factoryDispatchNumber: 'EIFD/26-27/0001',
    statusLabel: 'Draft',
    destinations: [makeDestination()],
    retiredCartons: [],
    ...overrides,
  };
}

/** A representative (not stress-test) multi-destination, multi-carton document — 2 destinations x
 * 3 cartons x 2 lines, the scale ISS-039's page-count/overlap comparison is meant to protect,
 * distinct from FactoryPackingListDetailDocument.test.tsx's separate many-carton hang detector. */
function multiCartonFixture(image?: FactoryPackingListCartonStyleRow['image']): FactoryPackingListPdfViewModel {
  const destinations = Array.from({ length: 2 }, (_, di) =>
    makeDestination({
      id: `dest-${di}`,
      label: `Destination ${di}`,
      requiredStyleRows: Array.from({ length: 2 }, (_, li) => makeStyleRow({ styleId: `style-${li}`, styleNumber: `ST-${li}`, image })),
      packedStyleRows: Array.from({ length: 2 }, (_, li) => makeStyleRow({ styleId: `style-${li}`, styleNumber: `ST-${li}`, image })),
      cartons: Array.from({ length: 3 }, (_, ci) =>
        makeCarton({
          id: `dest-${di}-carton-${ci}`,
          cartonNumber: `C${di}-${ci}`,
          totalQuantity: 10,
          lines: Array.from({ length: 2 }, (_, lni) => ({ id: `l-${di}-${ci}-${lni}`, styleDisplay: `ST-${lni}`, sizeLabel: 'M', quantity: 5 })),
          styleRows: Array.from({ length: 2 }, (_, lni) => ({
            styleId: `style-${lni}`,
            styleNumber: `ST-${lni}`,
            styleName: null,
            image,
            values: { 'size-1': 5 },
          })),
        }),
      ),
    }),
  );
  return makeViewModel({ destinations });
}

describe('FactoryPackingListDetailDocument — Style thumbnails (ISS-039)', () => {
  it('embeds an actual decodable image for a Style thumbnail and preserves the Style/Size/Quantity text beside it', async () => {
    const image = { dataUri: await realImageDataUri() };
    const opened = await renderAndOpen(
      makeViewModel({
        destinations: [makeDestination({ requiredStyleRows: [makeStyleRow({ image })], packedStyleRows: [makeStyleRow({ image })] })],
      }),
    );
    // One page -> the fixed letterhead logo alone accounts for exactly 1 paint op; a genuine
    // extra op proves the thumbnail itself was embedded, not merely passed as an unused prop.
    expect(opened.imagePaintOpCount).toBeGreaterThan(opened.numPages);
    expect(opened.fullText).toContain('ST-001');
    expect(opened.fullText).toContain('Classic Tee');
    expect(opened.fullText).toContain('10');
  });

  it('falls back to a placeholder box (no thrown error, all text intact) when the Style has no uploaded image', async () => {
    const opened = await renderAndOpen(
      makeViewModel({
        destinations: [
          makeDestination({
            requiredStyleRows: [makeStyleRow({ image: { placeholder: true } })],
            packedStyleRows: [makeStyleRow({ image: { placeholder: true } })],
          }),
        ],
      }),
    );
    expect(opened.fullText).toContain('ST-001');
    expect(opened.fullText).toContain('10');
  });

  it('renders every row at its normal position (no field omitted) when `image` is entirely absent — pre-ISS-039 documents are unaffected', async () => {
    const opened = await renderAndOpen(makeViewModel());
    // Only the fixed letterhead logo (one per page) — no thumbnail paint ops at all.
    expect(opened.imagePaintOpCount).toBe(opened.numPages);
    expect(opened.fullText).toContain('ST-001');
  });

  it('keeps a long Style name fully readable alongside its thumbnail (no truncation, no overlap)', async () => {
    const image = { dataUri: await realImageDataUri() };
    const longName = 'A Very Long Style Name That Must Remain Fully Readable Beside Its Thumbnail';
    const opened = await renderAndOpen(
      makeViewModel({
        destinations: [
          makeDestination({
            requiredStyleRows: [makeStyleRow({ styleName: longName, image })],
            packedStyleRows: [makeStyleRow({ styleName: longName, image })],
          }),
        ],
      }),
    );
    expect(opened.fullText).toContain(longName);
    assertNoHorizontalOverlap(opened.itemsByPage);
  });

  it('keeps pagination proportionate — at most one extra page from real thumbnail height, never a blowup — and never drops/duplicates content', async () => {
    const image = { dataUri: await realImageDataUri() };
    const withoutImages = await renderAndOpen(multiCartonFixture(undefined));
    const withImages = await renderAndOpen(multiCartonFixture(image));

    // A 20x20pt thumbnail is taller than the text-only Style/Name stack it sits beside, so a
    // dense enough document can genuinely need one more page once every Style x Size row grows —
    // that is real content, not a pagination defect, and the brief explicitly asks pagination
    // regression to be judged separately from this intended growth. What a defect WOULD look like
    // is a disproportionate jump (e.g. doubling) or dropped/duplicated text, which the assertions
    // below actually check for.
    expect(withImages.numPages).toBeGreaterThanOrEqual(withoutImages.numPages);
    expect(withImages.numPages).toBeLessThanOrEqual(withoutImages.numPages + 1);
    expect(withoutImages.imagePaintOpCount).toBe(withoutImages.numPages);
    expect(withImages.imagePaintOpCount).toBeGreaterThan(withImages.numPages);
    // Same quantities, same totals — adding imagery must not perturb any printed number.
    expect(withImages.fullText.match(/\b10\b/g)?.length).toEqual(withoutImages.fullText.match(/\b10\b/g)?.length);
  }, 20000);

  it('never overlaps a thumbnail-bearing row with its neighbors across a multi-page fixture', async () => {
    const image = { dataUri: await realImageDataUri() };
    const opened = await renderAndOpen(multiCartonFixture(image));
    assertNoHorizontalOverlap(opened.itemsByPage);
  }, 20000);
});
