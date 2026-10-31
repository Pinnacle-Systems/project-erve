import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { generateCartonLabelPdfBlob } from './generateCartonLabelPdf.js';
import type { CartonLabelSource } from './buildCartonLabelViewModel.js';
import type { FactoryPackingCartonView, PackingListDestinationView } from '../../types.js';

function makeCarton(overrides: Partial<FactoryPackingCartonView> = {}): FactoryPackingCartonView {
  return {
    id: 'carton-1',
    cartonNumber: 'C1',
    destinationId: 'dest-1',
    packageDetails: null,
    netWeight: null,
    grossWeight: null,
    dimensions: null,
    version: 1,
    totalQuantity: 10,
    destinationMismatch: false,
    auditState: 'INSPECTED',
    retired: false,
    retiredAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    lines: [
      {
        saleOrderLineId: 'line-1',
        styleId: 'style-1',
        styleNumber: 'ST-001',
        styleName: 'Classic Tee',
        primaryImage: null,
        sizeId: 'size-1',
        sizeCode: 'M',
        sizeLabel: 'Medium',
        quantity: 10,
        currentDestinationId: 'dest-1',
      },
    ],
    auditHistory: [],
    ...overrides,
  };
}

function makeDestination(
  overrides: Partial<PackingListDestinationView> = {},
): PackingListDestinationView {
  return {
    id: 'dest-1',
    distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' },
    label: 'Store 1',
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    addressLine1: '123 Test Street',
    addressLine2: null,
    city: 'Chennai',
    state: 'TN',
    country: 'India',
    postalCode: null,
    gstin: null,
    canMoveDistributor: false,
    lines: [],
    cartons: [],
    ...overrides,
  };
}

function makeSource(overrides: Partial<CartonLabelSource> = {}): CartonLabelSource {
  return {
    carton: makeCarton(),
    destination: makeDestination(),
    saleOrderNumber: 'EISO/26-27/0001',
    factoryName: 'Factory One',
    factoryDispatchNumber: 'EIFD/26-27/0001',
    ...overrides,
  };
}

describe('generateCartonLabelPdfBlob', () => {
  it('generates a PDF blob for a currently Inspected carton', async () => {
    const blob = await generateCartonLabelPdfBlob(makeSource(), {
      generatedAt: '2026-09-15T10:00:00Z',
    });
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it.each([1, 35])(
    'redacts factory provenance from actual PDF text and metadata with %s Style rows',
    async (count) => {
      const carton = makeCarton();
      carton.lines = Array.from({ length: count }, (_, index) => ({
        ...carton.lines[0]!,
        styleId: `style-${index}`,
        styleNumber: `STYLE-${index}`,
      }));
      carton.totalQuantity = count * 10;
      const source = makeSource({
        carton,
        factoryName: 'SECRET-FACTORY-NAME',
        factoryDispatchNumber: 'SECRET-FACTORY-REF',
      });
      const before = JSON.stringify(source);
      const blob = await generateCartonLabelPdfBlob(source, {
        generatedAt: '2026-09-15T10:00:00Z',
        generatedBy: 'SECRET-FACTORY-OPERATOR',
      });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const task = getDocument({ data: bytes.slice(), useSystemFonts: true });
      try {
        const document = await task.promise;
        const pages = [];
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
          const page = await document.getPage(pageNumber);
          pages.push(
            (await page.getTextContent()).items
              .flatMap((item) => ('str' in item ? [item.str] : []))
              .join(' '),
          );
        }
        const text = pages.join(' ');
        const metadata = await document.getMetadata();
        const exposed = text + JSON.stringify(metadata);
        expect(exposed).not.toMatch(/SECRET-FACTORY|Factory Dispatch|Factory One/);
        for (const required of [
          'Carton C1',
          'EISO/26-27/0001',
          'Distributor One',
          'Store 1',
          '123 Test Street',
          'Chennai',
          'TN',
          'India',
          'M',
          `Total: ${count * 10}`,
        ]) {
          expect(text).toContain(required);
        }
        for (let index = 0; index < count; index++) expect(text).toContain(`STYLE-${index}`);
        expect(document.numPages).toBeGreaterThanOrEqual(count === 1 ? 1 : 2);
        expect(JSON.stringify(source)).toBe(before);
        if (process.env.CARTON_LABEL_EVIDENCE_DIR) {
          const directory = resolve(process.env.CARTON_LABEL_EVIDENCE_DIR);
          await mkdir(directory, { recursive: true });
          await writeFile(resolve(directory, `carton-${count}-styles.pdf`), bytes);
          await writeFile(
            resolve(directory, `carton-${count}-styles.json`),
            JSON.stringify({ pages, metadata }, null, 2),
          );
        }
      } finally {
        await task.destroy();
      }
    },
  );

  it.each([9, 10, 11])('puts %i variable Size column headers into the actual carton PDF', async (sizeCount) => {
    const carton = makeCarton();
    const original = carton.lines[0]!;
    carton.lines = Array.from({ length: sizeCount }, (_, index) => ({
      ...original,
      saleOrderLineId: 'line-' + index,
      sizeId: 'size-' + index,
      sizeCode: 'SZ' + (index + 1),
      sizeLabel: 'Size ' + (index + 1),
      sizeSortOrder: index,
      quantity: index + 1,
    }));
    carton.totalQuantity = sizeCount * (sizeCount + 1) / 2;
    const blob = await generateCartonLabelPdfBlob(makeSource({ carton }), {
      generatedAt: '2026-09-15T10:00:00Z',
    });
    const task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true });
    try {
      const doc = await task.promise;
      const pages = [];
      for (let index = 1; index <= doc.numPages; index++) {
        const page = await doc.getPage(index);
        pages.push((await page.getTextContent()).items
          .flatMap((item) => 'str' in item ? [item.str] : [])
          .join(' '));
      }
      const fullText = pages.join(' ');
      expect(fullText).toContain('ST-001');
      expect(fullText).toContain('SZ1');
      expect(fullText).toContain('SZ' + sizeCount);
      expect(fullText).toContain('Total: ' + carton.totalQuantity);
      expect(fullText).not.toContain('Size Breakdown');
    } finally {
      await task.destroy();
    }
  });

  it.each(['NOT_INSPECTED', 'NEEDS_REINSPECTION'] as const)(
    'refuses to generate a label for a %s carton — labels must come from confirmed/audited data',
    async (auditState) => {
      await expect(
        generateCartonLabelPdfBlob(makeSource({ carton: makeCarton({ auditState }) }), {
          generatedAt: '2026-09-15T10:00:00Z',
        }),
      ).rejects.toThrow(/Inspected/);
    },
  );
});
