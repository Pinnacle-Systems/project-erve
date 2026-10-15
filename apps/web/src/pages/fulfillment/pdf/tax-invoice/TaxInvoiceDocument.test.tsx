import fs from 'node:fs/promises';
import path from 'node:path';
import { cloneElement } from 'react';
import { pdf } from '@react-pdf/renderer';
import { PdfDocument } from '../../../../lib/pdf/core/PdfDocument.js';
import { describe, expect, it } from 'vitest';
import { TaxInvoiceDocument } from './TaxInvoiceDocument.js';
import { buildTaxInvoiceViewModel } from './buildTaxInvoiceViewModel.js';
import {
  issuedTaxInvoiceFixture,
  nineStyleTaxInvoiceFixture,
  iss032TaxInvoiceFixture,
  iss032VisualFixtures,
} from './taxInvoicePdfFixture.js';

interface PdfNode {
  type?: string;
  value?: string;
  style?: { fontWeight?: number; objectFit?: string };
  children?: PdfNode[];
}
function nodes(root: PdfNode): PdfNode[] {
  return [root, ...(root.children ?? []).flatMap(nodes)];
}
async function render(invoice = issuedTaxInvoiceFixture(), imageDataUri?: string) {
  const model = buildTaxInvoiceViewModel(invoice);
  if (imageDataUri) for (const group of model.groups) group.image = { dataUri: imageDataUri };
  let layout: PdfNode | undefined;
  const shell = TaxInvoiceDocument({ viewModel: model, logoSrc: null });
  const instance = pdf(
    cloneElement(PdfDocument(shell.props), {
      onRender: (data: unknown) => {
        layout = (data as { _INTERNAL__LAYOUT__DATA_: PdfNode })._INTERNAL__LAYOUT__DATA_;
      },
    }),
  );
  const blob = await instance.toBlob();
  const all = nodes((instance.container as { document: PdfNode }).document);
  return {
    blob,
    text: all.map((node) => node.value ?? '').join('\n'),
    all,
    bytes: new TextDecoder().decode(await blob.arrayBuffer()),
    layout,
  };
}
describe('issued Tax Invoice PDF document', () => {
  it('keeps each financial header with opening descriptive content on the laid-out page', async () => {
    const image = await fs.readFile(new URL('../../../../../public/erve-logo.png', import.meta.url));
    const result = await render(
      iss032TaxInvoiceFixture(14),
      `data:image/png;base64,${image.toString('base64')}`,
    );
    let headers = 0;
    for (const page of result.layout!.children!) {
      for (const [index, child] of page.children!.entries()) {
        if (!nodes(child).some((node) => /^(SS26-|SYNTHETIC-STYLE-)/.test(node.value ?? '')))
          continue;
        headers++;
        const next = page.children![index + 1];
        expect(
          next && nodes(next).some((node) => node.value === 'Synthetic cotton printed T-shirt'),
        ).toBe(true);
      }
    }
    expect(headers).toBe(14);
  });
  it('keeps the six age sizes and complete Style code in one logical financial entry', async () => {
    const invoice = iss032TaxInvoiceFixture();
    const original = structuredClone(invoice);
    const result = await render(invoice);
    expect(result.text).toContain('SS26-14026001');
    for (const age of [9, 10, 11, 12, 13, 14]) expect(result.text).toContain(`${age} Years: 10`);
    expect(result.text).not.toContain('continued');
    expect(result.text).toContain('60 pcs');
    expect(result.text).toContain('INR 27,064.20');
    expect(result.text).toContain('INR 1,353.21');
    expect(result.text).toContain('INR 28,417.00');
    expect(result.bytes.match(/\/Type \/Page\b/g)).toHaveLength(1);
    expect(invoice).toEqual(original);
  });

  it('writes deterministic synthetic PDFs for actual visual inspection', async () => {
    const directory = process.env.ISS032_PDF_EVIDENCE_DIR ?? '.artifacts/iss032-pdf';
    await fs.mkdir(directory, { recursive: true });
    const imagePath = process.env.ISS032_IMAGE_PATH;
    const image = imagePath
      ? `data:image/png;base64,${(await fs.readFile(imagePath)).toString('base64')}`
      : undefined;
    for (const { name, invoice } of iss032VisualFixtures()) {
      const result = await render(invoice, name === 'missing-image' ? undefined : image);
      await fs.writeFile(
        path.join(directory, `${name}.pdf`),
        Buffer.from(await result.blob.arrayBuffer()),
      );
      await fs.writeFile(path.join(directory, `${name}.json`), JSON.stringify(invoice, null, 2));
    }
  }, 30000);
  it('preserves every group in the nine-Style/six-size A4 case', async () => {
    const invoice = nineStyleTaxInvoiceFixture();
    const model = buildTaxInvoiceViewModel(invoice);
    expect(model.groups).toHaveLength(9);
    expect(model.totalQuantity).toBe(96);
    const result = await render(invoice);
    for (let index = 1; index <= 9; index++) expect(result.text).toContain(`TEST-${index}`);
  });
  it('flows a description taller than a printable page without artificial financial entries', async () => {
    const invoice = iss032VisualFixtures().find(
      (fixture) => fixture.name === 'long-description',
    )!.invoice;
    const result = await render(invoice);
    expect(result.bytes.match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(1);
    expect(result.text).toContain('DESCRIPTION END MARKER');
    expect(result.text).not.toContain('continued');
    expect(result.text.match(/SS26-14026001/g)).toHaveLength(1);
    expect(
      result.text.match(/INR Twenty Eight Thousand Four Hundred Seventeen Only\./g),
    ).toHaveLength(1);
  });

  it('preserves every label and quantity in an eighty-size list', async () => {
    const invoice = iss032TaxInvoiceFixture(1, 80);
    const result = await render(invoice);
    for (let index = 1; index <= 80; index++)
      expect(result.text).toContain(`Synthetic size ${index} Years: 10`);
    expect(result.text).toContain('800 pcs');
    expect(result.text).not.toContain('continued');
  });

  it('keeps punctuation in a complete Size label with its quantity', async () => {
    const invoice = iss032TaxInvoiceFixture();
    invoice.documentSnapshot!.lines[0]!.size.label = '9 Years (Tall, relaxed)';
    const result = await render(invoice);
    expect(result.text).toContain('9 Years (Tall, relaxed): 10');
  });

  it('allows hundreds of complete size tokens to flow across pages', async () => {
    const invoice = iss032TaxInvoiceFixture(1, 360);
    const result = await render(invoice);
    expect(result.bytes.match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(1);
    expect(result.text).toContain('Synthetic size 360 Years: 10');
    expect(result.text.match(/SS26-14026001/g)).toHaveLength(1);
    expect(result.text).not.toContain('continued');
  });
  it('renders A4 portrait and frozen financial amounts with bold RCM No', async () => {
    const result = await render();
    expect(result.blob.type).toBe('application/pdf');
    const mediaBox = /\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/.exec(result.bytes)!;
    expect(Number(mediaBox[1])).toBeCloseTo(595.28, 2);
    expect(Number(mediaBox[2])).toBeCloseTo(841.89, 2);
    expect(result.text).toContain('INR 44,050.00');
    expect(result.text).toContain('+INR 0.40');
    expect(result.text).toContain('INR Forty Four Thousand Fifty Only.');
    expect(
      result.all.some(
        (node) =>
          node.style?.fontWeight === 700 && nodes(node).some((child) => child.value === 'No'),
      ),
    ).toBe(true);
    expect(result.bytes.match(/\/Type \/Page\b/g)).toHaveLength(1);
  });
  it('preserves historical EISO, multiple current orders and unavailable provenance in rendered text', async () => {
    const invoice = issuedTaxInvoiceFixture();
    invoice.documentSnapshot!.historicalBuyerOrderReference = {
      kind: 'HISTORICAL_EISO',
      value: 'EISO/103/25-26',
    };
    invoice.documentSnapshot!.dispatchOrders.push({
      id: 'do-2',
      number: 'DO/SECOND',
      cartonIds: [],
    });
    const first = await render(invoice);
    expect(first.text).toContain('EISO/103/25-26');
    expect(first.text).toContain('DO/25-26/0001, DO/SECOND');
    invoice.documentSnapshot = null;
    invoice.roundOffAdjustment = null;
    invoice.payableTotal = null;
    const legacy = await render(invoice);
    expect(legacy.text).toContain('Original issued total');
    expect(legacy.text).toContain('INR 44,049.60');
    expect(legacy.text).toContain('Issued Style, image and order details are unavailable');
    expect(legacy.text).not.toContain('Classic Tee');
    expect(legacy.text).not.toContain('DO/25-26/0001');
  });
  it('paginates long addresses and many Style rows without discarding rows or repeating final totals', async () => {
    const invoice = issuedTaxInvoiceFixture();
    invoice.billTo.addressLine2 = 'Long synthetic address for pagination verification. '.repeat(8);
    const line = invoice.lines[0]!;
    const issued = invoice.documentSnapshot!.lines[0]!;
    invoice.lines = Array.from({ length: 40 }, (_, index) => ({
      ...line,
      id: `line-${index}`,
      style: { ...line.style, id: `style-${index}` },
    }));
    invoice.documentSnapshot!.lines = invoice.lines.map((item, index) => ({
      ...issued,
      lineId: item.id,
      style: {
        ...issued.style,
        id: item.style.id,
        styleNumber: `FROZEN-${index}`,
        styleName: `Long synthetic Style ${index} for pagination verification`,
      },
    }));
    const result = await render(invoice);
    expect(result.bytes.match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(1);
    for (let index = 0; index < 40; index++)
      expect(result.text.replace(/\s/g, '')).toContain(`FROZEN-${index}`);
    expect(result.text.match(/INR Forty Four Thousand Fifty Only\./g)).toHaveLength(1);
  });

  it('renders CANCELLED watermark, cancellation banner and replacement references visually on PDF', async () => {
    const artifactDir = path.resolve('.artifacts/cancelled-invoice-visual-qa');
    await fs.mkdir(artifactDir, { recursive: true });

    // 1. Verify CANCELLED invoice PDF
    const cancelledInvoice = issuedTaxInvoiceFixture();
    cancelledInvoice.status = 'CANCELLED';
    cancelledInvoice.cancelledAt = '2026-10-14T08:00:00.000Z';
    cancelledInvoice.cancellationReason = 'Wrong customer state registered';
    cancelledInvoice.cancelledBy = { id: 'user-acct', name: 'Lead Accountant' };

    const cancelledResult = await render(cancelledInvoice);
    expect(cancelledResult.blob.type).toBe('application/pdf');
    expect(cancelledResult.text).toContain('CANCELLED');
    expect(cancelledResult.text).toContain('THIS TAX INVOICE HAS BEEN CANCELLED');
    expect(cancelledResult.text).toContain('Reason: Wrong customer state registered');
    await fs.writeFile(
      path.join(artifactDir, 'cancelled-single-page.pdf'),
      Buffer.from(await cancelledResult.blob.arrayBuffer()),
    );

    // 2. Verify Replacement invoice PDF with provenance
    const replacementInvoice = issuedTaxInvoiceFixture();
    replacementInvoice.invoiceNumber = 'EI/26-27/0002';
    replacementInvoice.replacesInvoiceId = 'inv-orig-1';
    replacementInvoice.replacesInvoiceNumber = 'EI/26-27/0001';

    const replacementResult = await render(replacementInvoice);
    expect(replacementResult.blob.type).toBe('application/pdf');
    expect(replacementResult.text.replace(/\s+/g, ' ')).toContain(
      'Replaces Cancelled Invoice: EI/26-27/0001',
    );
    expect(replacementResult.text).not.toContain('THIS TAX INVOICE HAS BEEN CANCELLED');
    await fs.writeFile(
      path.join(artifactDir, 'replacement-single-page.pdf'),
      Buffer.from(await replacementResult.blob.arrayBuffer()),
    );
  });

  it('paginates a CANCELLED invoice across multiple pages with fixed CANCELLED watermark on all pages and banner on page 1', async () => {
    const artifactDir = path.resolve('.artifacts/cancelled-invoice-visual-qa');
    await fs.mkdir(artifactDir, { recursive: true });

    const invoice = issuedTaxInvoiceFixture();
    invoice.status = 'CANCELLED';
    invoice.cancelledAt = '2026-10-14T08:00:00.000Z';
    invoice.cancellationReason = 'Commercial dispute and specification change';
    invoice.cancelledBy = { id: 'user-acct', name: 'Lead Accountant' };
    invoice.billTo.addressLine2 = 'Long synthetic address for pagination verification. '.repeat(8);
    const line = invoice.lines[0]!;
    const issued = invoice.documentSnapshot!.lines[0]!;
    invoice.lines = Array.from({ length: 40 }, (_, index) => ({
      ...line,
      id: `line-${index}`,
      style: { ...line.style, id: `style-${index}` },
    }));
    invoice.documentSnapshot!.lines = invoice.lines.map((item, index) => ({
      ...issued,
      lineId: item.id,
      style: {
        ...issued.style,
        id: item.style.id,
        styleNumber: `FROZEN-${index}`,
        styleName: `Long synthetic Style ${index} for pagination verification`,
      },
    }));
    const result = await render(invoice);
    const pageMatches = result.bytes.match(/\/Type \/Page\b/g);
    expect(pageMatches).toBeDefined();
    expect(pageMatches!.length).toBeGreaterThan(1);
    expect(result.text).toContain('CANCELLED');
    expect(result.text).toContain('THIS TAX INVOICE HAS BEEN CANCELLED');
    expect(result.text).toContain('Reason: Commercial dispute and specification change');
    for (let index = 0; index < 40; index++) {
      expect(result.text.replace(/\s/g, '')).toContain(`FROZEN-${index}`);
    }
    expect(result.text.match(/INR Forty Four Thousand Fifty Only\./g)).toHaveLength(1);

    await fs.writeFile(
      path.join(artifactDir, 'cancelled-multipage.pdf'),
      Buffer.from(await result.blob.arrayBuffer()),
    );
  });
});
