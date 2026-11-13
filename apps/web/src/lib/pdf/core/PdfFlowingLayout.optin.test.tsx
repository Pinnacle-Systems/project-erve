import { describe, expect, it } from 'vitest';
import { PdfDocument } from './PdfDocument.js';
import { PdfHeader } from './PdfHeader.js';
import { PdfKeyValueSection, type PdfKeyValueItem } from './PdfKeyValueSection.js';
import {
  expectNoStrandedLeadIns,
  renderAndInspectPdf,
  splitPageChrome,
  type InspectedPdf,
} from './pdfInspection.test-utils.js';

const ELLIPSIS = String.fromCharCode(0x2026);
const LONG_SUBTITLE = `AW26-0001 ${String.fromCharCode(0x2014)} ${'Premium Brushed Fleece Licensed Character Sweatshirt '.repeat(4)}For Kids`;

const headerRuns = (inspected: InspectedPdf, title: string, subtitle: string) =>
  splitPageChrome(inspected.runsByPage[0]!, `${title} ${subtitle}`).header;

describe('PdfHeader subtitleMaxLines (opt-in)', () => {
  it('caps the subtitle at the requested number of lines and ends it with an ellipsis', async () => {
    const inspected = await renderAndInspectPdf(
      <PdfDocument orientation="portrait">
        <PdfHeader title="STYLE MASTER" subtitle={LONG_SUBTITLE} subtitleMaxLines={2} />
      </PdfDocument>,
    );
    const subtitleLines = headerRuns(inspected, 'STYLE MASTER', LONG_SUBTITLE).filter((run) => run.str !== 'STYLE MASTER');
    expect(subtitleLines).toHaveLength(2);
    expect(subtitleLines.at(-1)!.str.endsWith(ELLIPSIS)).toBe(true);
  });

  it('leaves the subtitle completely unconstrained when the prop is not passed (default unchanged)', async () => {
    const inspected = await renderAndInspectPdf(
      <PdfDocument orientation="portrait">
        <PdfHeader title="STYLE MASTER" subtitle={LONG_SUBTITLE} />
      </PdfDocument>,
    );
    const subtitleLines = headerRuns(inspected, 'STYLE MASTER', LONG_SUBTITLE).filter((run) => run.str !== 'STYLE MASTER');
    expect(subtitleLines.length).toBeGreaterThan(2);
    expect(inspected.fullText).not.toContain(ELLIPSIS);
  });

  it('does not alter a subtitle that already fits', async () => {
    const render = (props: { subtitleMaxLines?: number }) =>
      renderAndInspectPdf(
        <PdfDocument orientation="portrait">
          <PdfHeader title="STYLE MASTER" subtitle="AW26-0001 and a short name" {...props} />
        </PdfDocument>,
      );
    const [capped, uncapped] = await Promise.all([render({ subtitleMaxLines: 2 }), render({})]);
    expect(capped.runsByPage).toEqual(uncapped.runsByPage);
  });
});

function labelledItems(count: number): PdfKeyValueItem[] {
  return Array.from({ length: count }, (_, i) => ({
    label: `Label ${String(i + 1).padStart(2, '0')}`,
    value: `Value ${String(i + 1).padStart(2, '0')} with enough words to wrap onto a second line inside its narrow column`,
  }));
}

const renderGrid = (items: PdfKeyValueItem[], props: { unbreakableItemMaxChars?: number }) =>
  renderAndInspectPdf(
    <PdfDocument orientation="portrait">
      <PdfHeader title="GRID" />
      <PdfKeyValueSection items={items} columns={3} {...props} />
    </PdfDocument>,
  );

describe('PdfKeyValueSection unbreakableItemMaxChars (opt-in)', () => {
  it('produces identical output to the default when every item is splittable-irrelevant (nothing near a page break)', async () => {
    const items = labelledItems(6);
    const [optedIn, plain] = await Promise.all([
      renderGrid(items, { unbreakableItemMaxChars: 1000 }),
      renderGrid(items, {}),
    ]);
    expect(optedIn.runsByPage).toEqual(plain.runsByPage);
  });

  it('never leaves a label at the foot of a page, wherever the page break falls', async () => {
    const labels = labelledItems(100).map((item) => item.label);
    // Sweep the item count so the page boundary lands on every row position of the grid.
    for (let count = 40; count <= 100; count++) {
      const inspected = await renderGrid(labelledItems(count), { unbreakableItemMaxChars: 1000 });
      if (inspected.numPages < 2) continue;
      expectNoStrandedLeadIns(inspected, 'GRID', labels);
    }
  }, 60_000);

  it('still lets an item longer than the threshold split across pages instead of collapsing the layout', async () => {
    const huge = 'word '.repeat(2500).trim();
    const inspected = await renderGrid([{ label: 'Description', value: huge }], { unbreakableItemMaxChars: 1000 });
    expect(inspected.numPages).toBeGreaterThanOrEqual(2);
    const words = inspected.runsByPage.flat().filter((run) => run.str.trim().startsWith('word'));
    expect(words.length).toBeGreaterThan(300);
  }, 30_000);
});
