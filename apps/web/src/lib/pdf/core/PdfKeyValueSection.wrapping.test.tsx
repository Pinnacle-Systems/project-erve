import { describe, expect, it } from 'vitest';
import { PdfDocument } from './PdfDocument.js';
import { PdfKeyValueSection } from './PdfKeyValueSection.js';
import {
  LONG_INDIAN_ADDRESS_TEXT,
  LONG_INDIAN_STORE_FIXTURE,
  expectNoHorizontalOverlap,
  expectWithinPrintableWidth,
  expectWordsIntact,
  renderAndInspectPdf,
} from './pdfInspection.test-utils.js';

function renderGrid(items: { label: string; value: string | null }[], columns: 2 | 3 | 4) {
  return renderAndInspectPdf(
    <PdfDocument orientation="landscape">
      <PdfKeyValueSection items={items} columns={columns} />
    </PdfDocument>,
  );
}

describe('PdfKeyValueSection word wrapping (D2)', () => {
  it.each([2, 3, 4] as const)('keeps every word of a long Indian address and Store name whole in a %i-column grid', async (columns) => {
    const inspected = await renderGrid(
      [
        { label: 'Destination', value: LONG_INDIAN_STORE_FIXTURE.label },
        { label: 'Destination Address', value: LONG_INDIAN_ADDRESS_TEXT },
        { label: 'Store Code', value: 'ST-014' },
      ],
      columns,
    );
    expectWordsIntact(inspected, LONG_INDIAN_STORE_FIXTURE.label);
    expectWordsIntact(inspected, LONG_INDIAN_ADDRESS_TEXT);
    expect(inspected.fullText).not.toMatch(/Ra-\s*jasthan|Col-\s*lectorate/);
    expectNoHorizontalOverlap(inspected);
    expectWithinPrintableWidth(inspected);
  });

  it('wraps the address over several lines inside its own column rather than truncating it', async () => {
    const inspected = await renderGrid([{ label: 'Destination Address', value: LONG_INDIAN_ADDRESS_TEXT }], 4);
    const addressRuns = inspected.runsByPage[0]!.filter((run) => run.str !== 'Destination Address');
    expect(addressRuns.length).toBeGreaterThan(1);
    expect(inspected.fullText).toContain('342001');
    expect(inspected.fullText).not.toContain('…');
  });

  it('controlled fallback: an over-long unbroken token is wrapped inside its column — no overlap, no clipping, nothing dropped', async () => {
    const unbroken = 'Y'.repeat(120);
    const inspected = await renderGrid(
      [
        { label: 'Destination Address', value: `Plot${unbroken} Road, Jodhpur` },
        { label: 'Store Code', value: 'ST-015' },
        { label: 'Distributor', value: 'Distributor V' },
        { label: 'Status', value: 'Dispatched' },
      ],
      4,
    );
    expectNoHorizontalOverlap(inspected);
    expectWithinPrintableWidth(inspected);
    // Nothing silently omitted: every Y survives the wrapping.
    const rendered = inspected.runsByPage.flat().map((run) => run.str).join('');
    expect(rendered.match(/Y/g)?.length).toBe(120);
    expect(inspected.fullText).toContain('Road, Jodhpur');
  });

  it('renders missing optional values as the empty-value dash without failing', async () => {
    const inspected = await renderGrid(
      [
        { label: 'Destination Address', value: null },
        { label: 'Store Code', value: '' },
      ],
      3,
    );
    expect(inspected.fullText).toContain('—');
    expect(inspected.fullText).not.toMatch(/null|undefined/);
  });
});
