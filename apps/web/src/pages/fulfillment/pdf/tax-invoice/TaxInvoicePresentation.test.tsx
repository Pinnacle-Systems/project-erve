import fs from 'node:fs/promises';
import path from 'node:path';
import { pdf } from '@react-pdf/renderer';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { createSolidColorPngDataUri } from '../../../../test-support/solid-color-png.js';
import { TaxInvoiceDocument } from './TaxInvoiceDocument.js';
import { buildTaxInvoiceViewModel } from './buildTaxInvoiceViewModel.js';
import { buildTaxInvoiceLineGroups } from '../../tax-invoice-line-groups.js';
import {
  issuedTaxInvoiceFixture,
  iss032TaxInvoiceFixture,
  iss032VisualFixtures,
  nineStyleTaxInvoiceFixture,
} from './taxInvoicePdfFixture.js';

async function rendered(invoice = issuedTaxInvoiceFixture(), imagery = false) {
  const model = buildTaxInvoiceViewModel(invoice);
  if (imagery)
    model.groups.forEach((group, index) => {
      group.image = {
        dataUri: createSolidColorPngDataUri(
          index % 2 ? 120 : 40,
          index % 2 ? 40 : 120,
          [30, 100, 160],
        ),
      };
    });
  const blob = await pdf(<TaxInvoiceDocument viewModel={model} logoSrc={null} />).toBlob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const task = getDocument({ data: bytes.slice(), useSystemFonts: true });
  try {
    const document = await task.promise;
    const pages = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const height = page.view[3]!;
      const items = (await page.getTextContent()).items.flatMap((item) =>
        'str' in item && item.str.trim()
          ? [
              {
                text: item.str,
                x: item.transform[4] as number,
                y: height - item.transform[5],
                width: item.width,
                height: item.height,
              },
            ]
          : [],
      );
      const operators = await page.getOperatorList();
      const images = [];
      let matrix = [1, 0, 0, 1, 0, 0];
      const stack: number[][] = [];
      for (let index = 0; index < operators.fnArray.length; index++) {
        const operation = operators.fnArray[index];
        if (operation === OPS.save) stack.push([...matrix]);
        else if (operation === OPS.restore) matrix = stack.pop()!;
        else if (operation === OPS.transform) {
          const [a, b, c, d, e, f] = matrix as [number, number, number, number, number, number];
          const [g, h, i, j, k, l] = operators.argsArray[index] as [
            number,
            number,
            number,
            number,
            number,
            number,
          ];
          matrix = [
            a * g + c * h,
            b * g + d * h,
            a * i + c * j,
            b * i + d * j,
            a * k + c * l + e,
            b * k + d * l + f,
          ];
        } else if (operation === OPS.paintImageXObject) {
          const image = operators.argsArray[index] as [string, number, number];
          const xs = [
            matrix[4]!,
            matrix[4]! + matrix[0]!,
            matrix[4]! + matrix[2]!,
            matrix[4]! + matrix[0]! + matrix[2]!,
          ];
          const ys = [
            matrix[5]!,
            matrix[5]! + matrix[1]!,
            matrix[5]! + matrix[3]!,
            matrix[5]! + matrix[1]! + matrix[3]!,
          ];
          images.push({
            x: Math.min(...xs),
            y: height - Math.max(...ys),
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys),
            naturalWidth: image[1],
            naturalHeight: image[2],
          });
        }
      }
      pages.push({ number, width: page.view[2], height, items, images });
    }
    return {
      bytes,
      pages,
      text: pages.flatMap((page) => page.items.map((item) => item.text)).join(' '),
    };
  } finally {
    await task.destroy();
  }
}

describe('Batch 8 real Tax Invoice presentation', () => {
  it('captures matched synthetic A4 evidence without changing inputs', async () => {
    const directory = process.env.BATCH8_PDF_EVIDENCE_DIR;
    const fixtures = [
      { name: 'two-styles', invoice: iss032TaxInvoiceFixture(2) },
      { name: 'nine-styles', invoice: nineStyleTaxInvoiceFixture() },
      { name: 'nine-images', invoice: nineStyleTaxInvoiceFixture() },
      { name: 'mixed-images', invoice: iss032TaxInvoiceFixture(2) },
      { name: 'intra', invoice: issuedTaxInvoiceFixture() },
      { name: 'unresolved', invoice: issuedTaxInvoiceFixture({ gstTreatment: null }) },
      ...iss032VisualFixtures(),
    ];
    for (const { name, invoice } of fixtures) {
      const original = structuredClone(invoice);
      const result = await rendered(invoice, name === 'mixed-images' || name === 'nine-images');
      expect(invoice).toEqual(original);
      if (name === 'nine-images')
        expect(result.pages.flatMap((page) => page.images)).toHaveLength(9);
      for (const page of result.pages) {
        expect(page.width).toBeCloseTo(595.28, 1);
        expect(page.height).toBeCloseTo(841.89, 1);
        expect(
          page.items.some(
            (item) =>
              item.y > 72 &&
              item.y < 798 &&
              !/^(Style \/ Size : Quantity|Qty|HSN \/ GST|MRP \(INR\)|Rate \(INR\)|Taxable \(INR\))$/.test(
                item.text,
              ),
          ),
        ).toBe(true);
        for (const item of page.items) {
          if (item.text === 'CANCELLED') continue;
          expect(item.x, `${name}: ${item.text}`).toBeGreaterThanOrEqual(27);
          expect(item.x + item.width, `${name}: ${item.text}`).toBeLessThanOrEqual(568.5);
          expect(item.y, `${name}: ${item.text}`).toBeGreaterThan(0);
          expect(item.y).toBeLessThan(827);
        }
        for (const image of page.images) {
          expect(image.x).toBeGreaterThanOrEqual(28);
          expect(image.x + image.width).toBeLessThanOrEqual(568);
          expect(image.y).toBeGreaterThanOrEqual(72);
          expect(image.y + image.height).toBeLessThanOrEqual(798);
          expect(image.width / image.height).toBeCloseTo(
            image.naturalWidth / image.naturalHeight,
            2,
          );
        }
      }
      const normalized = (value: string) => value.replace(/[\s,|]/g, '');
      for (const group of buildTaxInvoiceLineGroups(invoice)) {
        for (const source of group.sourceLines) {
          const label = invoice.documentSnapshot!.lines.find((line) => line.lineId === source.id)!
            .size.label;
          const token = /^\d+$/.test(label)
            ? `${label}-${source.quantity}`
            : `${label}: ${source.quantity}`;
          expect(normalized(result.text), name).toContain(normalized(token));
        }
        expect(normalized(result.text), name).toContain(normalized(group.styleNumber));
      }
      for (const page of result.pages) {
        const body = page.items.filter(
          (item) => item.y > 60 && item.y < 800 && item.text !== 'CANCELLED',
        );
        for (const item of body) {
          expect(
            item.y - item.height,
            `${name}: body above reserved header`,
          ).toBeGreaterThanOrEqual(71);
          expect(item.y, `${name}: body below reserved footer`).toBeLessThanOrEqual(798);
        }
        for (let index = 0; index < body.length; index++)
          for (const other of body.slice(index + 1)) {
            const item = body[index]!;
            const horizontal =
              Math.min(item.x + item.width, other.x + other.width) - Math.max(item.x, other.x);
            const vertical =
              Math.min(item.y, other.y) -
              Math.max(item.y - item.height * 0.7, other.y - other.height * 0.7);
            expect(
              horizontal > 1 && vertical > 1,
              `${name}: overlapping ${item.text} / ${other.text}`,
            ).toBe(false);
          }
      }
      expect(result.text.match(/Amount chargeable/g)).toHaveLength(1);
      expect(result.text).toContain(invoice.invoiceNumber);
      if (directory) {
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(path.join(directory, `${name}.pdf`), result.bytes);
        await fs.writeFile(
          path.join(directory, `${name}.json`),
          JSON.stringify({ invoice, pages: result.pages }, null, 2),
        );
      }
    }
  }, 60000);
});

describe('saved GST component authority in actual PDF output', () => {
  it.each(['FINALIZED', 'CANCELLED'] as const)(
    'selects only saved-treatment components for %s without recalculating values',
    async (status) => {
      for (const treatment of ['INTER', 'INTRA', null] as const) {
        const invoice = issuedTaxInvoiceFixture({
          status,
          gstTreatment: treatment,
          totalCgst: '12.3456789',
          totalSgst: '98.7654321',
          totalIgst: '45.6789123',
        });
        const original = structuredClone(invoice);
        const result = await rendered(invoice);
        expect(invoice).toEqual(original);
        if (treatment === 'INTER') {
          expect(result.text).toContain('IGST');
          expect(result.text).not.toContain('CGST');
          expect(result.text).not.toContain('SGST');
          expect(result.text).toContain('45.6789123');
        } else if (treatment === 'INTRA') {
          expect(result.text).toContain('CGST');
          expect(result.text).toContain('SGST');
          expect(result.text).not.toContain('IGST');
          expect(result.text).toContain('12.3456789');
          expect(result.text).toContain('98.7654321');
        } else {
          expect(result.text).toContain('GST treatment is unresolved');
          for (const label of ['CGST', 'SGST', 'IGST']) expect(result.text).not.toContain(label);
        }
        expect(result.text).toContain('44,050.00');
        expect(result.text).toContain('+INR 0.40');
      }
    },
    30000,
  );
  it('distinguishes an applicable saved zero from a missing amount', async () => {
    const zero = await rendered(issuedTaxInvoiceFixture({ gstTreatment: 'INTER', totalIgst: '0' }));
    expect(zero.text).toMatch(/IGST\s+INR 0.00/);
    const missing = await rendered(
      issuedTaxInvoiceFixture({ gstTreatment: 'INTER', totalIgst: null }),
    );
    expect(missing.text).toMatch(/IGST\s+Unavailable/);
  });
});

it('uses shared financial headings and shortens ordinary rows against the measured current-main baseline', async () => {
  const two = await rendered(iss032TaxInvoiceFixture(2));
  expect(two.pages).toHaveLength(1);
  expect(two.text.match(/MRP \(INR\)/g)).toHaveLength(1);
  const headings = two.pages[0]!.items.filter((item) =>
    /^(SS26-|SYNTHETIC-STYLE-)/.test(item.text),
  );
  expect(headings).toHaveLength(2);
  // Fresh current-main missing-image baseline: 102.5pt between these exact headings.
  expect(headings[1]!.y - headings[0]!.y).toBeLessThan(102.5);
  const nine = await rendered(nineStyleTaxInvoiceFixture());
  expect(nine.pages.length).toBeLessThanOrEqual(2);
  expect(nine.text).toContain('TEST-9');
});

it('flows page-tall Style identity without duplicating the financial entry', async () => {
  const invoice = iss032TaxInvoiceFixture();
  for (const line of invoice.documentSnapshot!.lines)
    line.style.styleName =
      'Very long issued Style identity retained in full. '.repeat(150) + 'IDENTITY END MARKER';
  const result = await rendered(invoice);
  expect(result.pages.length).toBeGreaterThan(1);
  expect(result.text).toContain('IDENTITY END MARKER');
  expect(result.text.match(/SS26-14026001/g)).toHaveLength(1);
  for (const page of result.pages) for (const item of page.items) expect(item.y).toBeLessThan(827);
}, 20000);

it.each(['INTRA', 'INTER'] as const)(
  'preserves mixed-band and applicable zero-rated HSN values for %s',
  async (gstTreatment) => {
    const invoice = issuedTaxInvoiceFixture({ gstTreatment });
    invoice.hsnSummary = [
      {
        hsnCode: '61091000',
        gstPercent: '5',
        taxableValue: '123.456789',
        cgstAmount: '12.123456',
        sgstAmount: '98.987654',
        igstAmount: '45.456789',
      },
      {
        hsnCode: '00000000',
        gstPercent: '0',
        taxableValue: '50',
        cgstAmount: '0',
        sgstAmount: '0',
        igstAmount: '0',
      },
    ];
    const original = structuredClone(invoice);
    const result = await rendered(invoice);
    expect(result.text).toContain('00000000');
    expect(result.text).toContain('123.456789');
    expect(result.text).toContain('0%');
    if (gstTreatment === 'INTRA') {
      expect(result.text).toContain('12.123456');
      expect(result.text).toContain('98.987654');
      expect(result.text).not.toContain('45.456789');
    } else {
      expect(result.text).toContain('45.456789');
      expect(result.text).not.toContain('12.123456');
      expect(result.text).not.toContain('98.987654');
    }
    expect(invoice).toEqual(original);
  },
);

it('keeps the last ordinary Style with financial totals at the nine-Style page boundary', async () => {
  const result = await rendered(nineStyleTaxInvoiceFixture());
  const totalsPage = result.pages.find((page) =>
    page.items.some((item) => item.text === 'Final payable'),
  )!;
  expect(totalsPage.items.some((item) => item.text === 'TEST-9')).toBe(true);
});

it('flows a short newline-rich identity rather than clipping its final line', async () => {
  const invoice = iss032TaxInvoiceFixture();
  for (const line of invoice.documentSnapshot!.lines)
    line.style.styleName = 'A\n'.repeat(75) + 'END';
  const result = await rendered(invoice);
  expect(result.text).toContain('END');
  expect(
    result.pages.flatMap((page) => page.items).filter((item) => item.text === 'A'),
  ).toHaveLength(75);
  expect(result.text.match(/SS26-14026001/g)).toHaveLength(1);
  for (const page of result.pages) for (const item of page.items) expect(item.y).toBeLessThan(827);
}, 20000);

it('fits the ordinary nine-Style reference on one A4 page using Style names instead of descriptions', async () => {
  const nine = await rendered(nineStyleTaxInvoiceFixture(), true);
  expect(nine.pages).toHaveLength(1);
  expect(nine.pages[0]!.images).toHaveLength(9);
  const invoice = iss032TaxInvoiceFixture(2);
  const original = structuredClone(invoice);
  const result = await rendered(invoice);
  expect(result.text).toContain('Synthetic cotton printed T-shirt');
  expect(result.text).not.toContain('Soft cotton jersey');
  expect(result.text).toContain('Colour: Deep ocean blue with coral print');
  expect(invoice).toEqual(original);
});

it('preserves newline-rich Size labels and all six quantities without clipping the compact row', async () => {
  const invoice = iss032TaxInvoiceFixture();
  invoice.documentSnapshot!.lines.forEach((line, index) => {
    line.size.label = 'A\n'.repeat(24) + `END${index}`;
  });
  const original = structuredClone(invoice);
  const result = await rendered(invoice);
  const compact = result.text.replace(/\s/g, '');
  for (let index = 0; index < 6; index++) expect(compact).toContain(`END${index}:10`);
  for (const page of result.pages) for (const item of page.items) expect(item.y).toBeLessThan(827);
  expect(invoice).toEqual(original);
}, 20000);
