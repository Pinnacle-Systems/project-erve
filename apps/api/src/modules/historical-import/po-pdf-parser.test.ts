// Unit tests for the AW25/SS26 parser, built entirely against synthetic
// PDFs (H1 plan §23) — never real historic customer PDFs. Coordinates below
// mirror the real AW25/SS26 template's layout (confirmed by hand against
// the EI25001/EI26001 samples during development), so these fixtures
// exercise the actual anchor-matching/table-reconstruction logic, not a
// simplified stand-in for it.
import { describe, expect, it } from 'vitest';
import { buildSyntheticPdf, type SyntheticTextRun } from './__fixtures__/synthetic-pdf.js';
import { parsePurchaseOrderBuffer } from './po-pdf-parser.js';

/** Small enough that pdfjs never merges two visually-close-but-distinct synthetic runs into one text item (it merges adjacent glyphs with near-zero gaps, and Helvetica-8pt's computed widths overrun this fixture's column spacing at the default size) — real per-document font metrics differ from base14 Helvetica, which is why this only needs tuning here, not in the parser itself. */
const FIXTURE_FONT_SIZE = 5;

/** A complete, well-formed AW25-shaped header+table, matching the real template's relative positions. Individual tests start from this and override/omit specific runs to exercise a single behavior at a time. */
function baseRuns(): SyntheticTextRun[] {
  const runs: SyntheticTextRun[] = [
    // Header grid, row 1 (labels) / row 2 (values) — several columns share one visual row, exactly like the real template.
    { text: 'Supplier', x: 147, y: 551 },
    { text: 'Season', x: 382, y: 551 },
    { text: 'The order nr must be stated on all', x: 467, y: 551 },
    { text: 'License Style', x: 604, y: 551 },
    { text: 'Clifton export Pvt Ltd', x: 147, y: 542 },
    { text: 'AW25', x: 383, y: 542 },
    { text: 'invoices', x: 503, y: 542 },
    { text: 'LMIX29524002', x: 601, y: 542 },
    { text: 'EI25001', x: 504, y: 533 },
    // Header grid, row 2 (labels) / row 3 (values).
    { text: 'Total qty', x: 147, y: 513 },
    { text: 'Payment terms', x: 206, y: 513 },
    { text: 'Curr', x: 327, y: 513 },
    { text: 'Suppliers cp', x: 410, y: 513 },
    { text: 'Order date', x: 484, y: 513 },
    { text: 'Shipment date', x: 525, y: 513 },
    { text: '1008', x: 147, y: 504 },
    { text: '30 days on receipt of GRN', x: 206, y: 504 },
    { text: 'INR', x: 327, y: 504 },
    { text: '336', x: 412, y: 504 },
    { text: 'rs / pcs', x: 423, y: 504 },
    { text: '15/08/2025', x: 484, y: 504 },
    { text: '30/09/2025', x: 525, y: 504 },
    // Description block.
    { text: 'Approval steps', x: 20, y: 455 },
    { text: 'Fitting S: 4 years - 2 Pcs', x: 20, y: 443 },
    { text: "Girls Hoody", x: 20, y: 360 },
    { text: 'Description', x: 20, y: 303 },
    { text: "*ST1: Girls Long Sleeve Hoody - Barbie", x: 20, y: 294 },
    { text: '*HS 61061000 Girls/ Hoody', x: 20, y: 285 },
    // Style/Colour/Description/size table.
    { text: 'Style', x: 23, y: 347 },
    { text: 'Colour', x: 53, y: 347 },
    { text: 'Description', x: 85, y: 347 },
    { text: 'Artwork', x: 283, y: 347 },
    { text: 'Extra', x: 309, y: 347 },
    { text: '3', x: 350, y: 346 },
    { text: '4', x: 377, y: 346 },
    { text: '5', x: 401, y: 346 },
    { text: '6', x: 423, y: 346 },
    { text: '7', x: 444, y: 346 },
    { text: '8', x: 468, y: 346 },
    { text: 'Total', x: 484, y: 347 },
    { text: 'artwork', x: 309, y: 339 },
    { text: 'Girls', x: 23, y: 331 },
    { text: 'Hoody', x: 23, y: 323 },
    { text: '12-1310', x: 53, y: 331 },
    { text: 'TCX', x: 53, y: 323 },
    { text: 'Blushing', x: 53, y: 314 },
    { text: 'Bride', x: 53, y: 306 },
    { text: 'Girls Long', x: 85, y: 331 },
    { text: 'Sleeve Hoody', x: 85, y: 323 },
    { text: 'LMIX29524002', x: 279, y: 332 },
    { text: '168', x: 348, y: 322 },
    { text: '168', x: 375, y: 322 },
    { text: '168', x: 399, y: 322 },
    { text: '168', x: 420, y: 322 },
    { text: '168', x: 442, y: 322 },
    { text: '168', x: 466, y: 322 },
    { text: '1008 Pcs', x: 488, y: 322 },
  ];
  return runs.map((run) => ({ fontSize: FIXTURE_FONT_SIZE, ...run }));
}

async function parse(runs: SyntheticTextRun[], overrides?: Partial<Parameters<typeof parsePurchaseOrderBuffer>[0]>) {
  const pdf = buildSyntheticPdf(runs);
  return parsePurchaseOrderBuffer({
    fileBuffer: pdf,
    sourceFileName: 'synthetic.pdf',
    relativePath: 'synthetic.pdf',
    sourceSizeBytes: pdf.length,
    sourceSeasonFolder: 'AW25',
    ...overrides,
  });
}

describe('parsePurchaseOrderBuffer — AW25/SS26 template', () => {
  it('keeps a misspelled lower heading and its clauses out of the Style name', async () => {
    const runs = baseRuns().map((run) => run.text === 'Description' && run.x === 20 ? { ...run, text: 'Descrition', y: 306 } : run);
    const result = await parse([...runs,
      { text: '*For detailed Trims and Accessories please refer Bill of Material.', x: 20, y: 276, fontSize: 5 },
      { text: '*Any delay will cause penalties as per the sales and distribution team', x: 20, y: 267, fontSize: 5 },
    ]);
    expect(result.styleName.value).toBe('Girls Hoody');
    expect(result.description.value).toContain('*ST1: Girls Long Sleeve Hoody - Barbie');
    expect(result.documentarySections?.reviewReasons).toEqual([]);
  });

  it('retains the order-detail instruction above approval steps in source order', async () => {
    const result = await parse([...baseRuns(),
      { text: 'FOR ALL ADDITIONAL ORDER DETAILS, WE REFER TO OUR PLM-SYSTEM DELOGUE', x: 20, y: 465, fontSize: 5 },
      { text: '*For detailed Trims and Accessories please refer Bill of Material.', x: 20, y: 276, fontSize: 5 },
      { text: '*Any delay will cause penalties as per the sales and distribution team', x: 20, y: 267, fontSize: 5 },
    ]);
    expect(result.documentarySections?.jobOrderDisclaimer).toBe(
      'FOR ALL ADDITIONAL ORDER DETAILS, WE REFER TO OUR PLM-SYSTEM DELOGUE\n\nFitting S: 4 years - 2 Pcs\n\n*For detailed Trims and Accessories please refer Bill of Material.\n*Any delay will cause penalties as per the sales and distribution team',
    );
  });

  it.each([false, true])('separates documentary sections without manufacturing clauses (full=%s)', async (full) => {
    const result = await parse([...baseRuns(),
      { text: 'Photo Sample: 2 Pcs', x: 20, y: 432, fontSize: 5 },
      { text: 'Above samples are for approval only', x: 20, y: 421, fontSize: 5 },
      { text: '*For detailed Trims and Accessories please refer Bill of Material.', x: 20, y: 276, fontSize: 5 },
      { text: '*Any delay will cause penalties as per the sales and distribution team', x: 20, y: 267, fontSize: 5 },
      ...(full ? [
        { text: '*100% AQL Inspection.', x: 20, y: 258, fontSize: 5 },
        { text: '*Delivery date needs to be respected to avoid any loss of sales or discounts.', x: 20, y: 249, fontSize: 5 },
      ] : []),
    ]);
    expect(result.description.value).toBe("Girls Long Sleeve Hoody\n\n*ST1: Girls Long Sleeve Hoody - Barbie\n*HS 61061000 Girls/ Hoody");
    expect(result.documentarySections?.tableDescriptionRaw).toBe('Girls Long\nSleeve Hoody');
    expect(result.approvalSampleInstructions.value).toBe('Fitting S: 4 years - 2 Pcs\nPhoto Sample: 2 Pcs\nAbove samples are for approval only');
    expect(result.documentarySections?.reviewReasons).toEqual([]);
    expect(result.documentarySections?.disclaimerText).toBe(
      '*For detailed Trims and Accessories please refer Bill of Material.\n*Any delay will cause penalties as per the sales and distribution team' +
      (full ? '\n*100% AQL Inspection.\n*Delivery date needs to be respected to avoid any loss of sales or discounts.' : ''),
    );
  });

  it('parses a complete, well-formed document as OK with every field extracted', async () => {
    const result = await parse(baseRuns());
    expect(result.parseStatus).toBe('OK');
    expect(result.warnings).toEqual([]);
    expect(result.legacyReferenceNumber.value).toBe('EI25001');
    expect(result.documentSeason.value).toBe('AW25');
    expect(result.factoryName.value).toBe('Clifton export Pvt Ltd');
    expect(result.licenseStyleLmix.value).toBe('LMIX29524002');
    expect(result.styleName.value).toBe("Girls Hoody");
    expect(result.colour.value).toBe('12-1310 TCX Blushing Bride');
    expect(result.description.value).toBe("Girls Long Sleeve Hoody");
    expect(result.hsnCode.value).toBe('61061000');
    expect(result.orderDate.value).toBe('2025-08-15');
    expect(result.shipmentDate.value).toBe('2025-09-30');
    expect(result.unitRate.value).toBe('336');
    expect(result.currency.value).toBe('INR');
    expect(result.paymentTerms.value).toBe('30 days on receipt of GRN');
    expect(result.sizeQuantities).toEqual([
      { sizeCode: '3', quantity: 168 },
      { sizeCode: '4', quantity: 168 },
      { sizeCode: '5', quantity: 168 },
      { sizeCode: '6', quantity: 168 },
      { sizeCode: '7', quantity: 168 },
      { sizeCode: '8', quantity: 168 },
    ]);
    expect(result.tableTotalQuantity.value).toBe(1008);
    expect(result.headerTotalQuantity.value).toBe(1008);
    expect(result.quantitySumMatchesTotal).toBe(true);
    expect(result.seasonFolderMismatch).toBe(false);
  });

  it('reconstructs the correct field values even when the content-stream item order is scrambled', async () => {
    const shuffled = [...baseRuns()];
    // Fisher-Yates with a fixed seed-free deterministic swap pattern — the
    // point is any stream order must reconstruct identically, since
    // everything is keyed off (x, y), never array position.
    for (let i = shuffled.length - 1; i > 0; i -= 3) {
      const j = (i * 7) % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    const result = await parse(shuffled);
    expect(result.parseStatus).toBe('OK');
    expect(result.legacyReferenceNumber.value).toBe('EI25001');
    expect(result.sizeQuantities.map((s) => s.quantity)).toEqual([168, 168, 168, 168, 168, 168]);
  });

  it('handles a Season value glued directly onto its label with no space ("SeasonAW25")', async () => {
    const runs = baseRuns().filter((r) => r.text !== 'Season' && r.text !== 'AW25');
    runs.push({ text: 'SeasonAW25', x: 382, y: 551, fontSize: FIXTURE_FONT_SIZE });
    const result = await parse(runs);
    expect(result.documentSeason.value).toBe('AW25');
  });

  it('handles a label wrapped across two lines ("Shipment" / "date"), pushing its value down one more row — matches the real SS26 template variant', async () => {
    const runs = baseRuns().filter((r) => r.text !== 'Shipment date' && r.text !== '30/09/2025');
    runs.push(
      { text: 'Shipment', x: 525, y: 513, fontSize: FIXTURE_FONT_SIZE },
      { text: 'date', x: 525, y: 504, fontSize: FIXTURE_FONT_SIZE },
      { text: '30/09/2025', x: 525, y: 494, fontSize: FIXTURE_FONT_SIZE },
    );
    const result = await parse(runs);
    expect(result.shipmentDate.value).toBe('2025-09-30');
  });

  it('skips an unrelated interleaved line between a label row and its value row', async () => {
    const runs = baseRuns();
    // Simulate an address-block line sitting at an intermediate y, exactly
    // like the real SS26 template's "Tamil Nadu 64160" address continuation
    // landing between the header-grid label row and its value row.
    runs.push({ text: '154, Some Road, Some City', x: 20, y: 509, fontSize: FIXTURE_FONT_SIZE });
    const result = await parse(runs);
    expect(result.parseStatus).toBe('OK');
    expect(result.orderDate.value).toBe('2025-08-15');
  });

  it('falls back to the table Artwork column for the LMIX code when the "License Style" label AND the header value are both entirely absent', async () => {
    // Removes the label item AND the header-grid's own LMIX value item —
    // genuinely nothing left in the header region, so this must fall all
    // the way through to the table's Artwork-column copy.
    const runs = baseRuns().filter((r) => r.text !== 'License Style' && r.text !== 'LMIX29524002');
    runs.push({ text: 'LMIX29524002', x: 279, y: 332, fontSize: FIXTURE_FONT_SIZE });
    const result = await parse(runs);
    expect(result.licenseStyleLmix.value).toBe('LMIX29524002');
  });

  it('uses the header\'s own standalone (unlabeled) LMIX value when the "License Style" label is absent but the value itself is still present — H2A regression for the EI26041-EI26050 template variant', async () => {
    // Real AW25/SS26 template variant (H2A finding): on a contiguous block
    // of real SS26 documents, "License Style" never appears as label text
    // anywhere in the content stream, but the header grid's own LMIX value
    // item is still there, unanchored to any label. Removing only the label
    // item (keeping the value item at its real header-row position)
    // reproduces that exactly.
    const runs = baseRuns().filter((r) => r.text !== 'License Style');
    const result = await parse(runs);
    expect(result.licenseStyleLmix.value).toBe('LMIX29524002');
  });

  it('prefers the header\'s own standalone LMIX value over a DIFFERENT, stale Artwork-column copy — H2A regression for the EI26042 numbering anomaly', async () => {
    // Reproduces the real EI26042.pdf defect: the header grid's own LMIX
    // value is correct and present (just unlabeled), but the table's
    // Artwork-column copy is stale — a copy/paste carry-over from a
    // neighboring order — and reads a DIFFERENT code. The header's own
    // value must win; the parser must never prefer the Artwork fallback
    // when a valid header value is genuinely present.
    const runs = baseRuns().filter((r) => r.text !== 'License Style' && r.text !== 'LMIX29524002');
    runs.push(
      // Header grid's own value — correct, unlabeled.
      { text: 'LMIX42026010', x: 601, y: 542, fontSize: FIXTURE_FONT_SIZE },
      // Table Artwork column — stale/wrong (a different order's code).
      { text: 'LMIX42026007', x: 279, y: 332, fontSize: FIXTURE_FONT_SIZE },
    );
    const result = await parse(runs);
    expect(result.licenseStyleLmix.value).toBe('LMIX42026010');
  });

  it('prefers the label-anchored header LMIX over the table Artwork column even when they disagree', async () => {
    // The ordinary (label-anchored) path must remain authoritative over
    // Artwork too, not just the new standalone-header fallback path.
    const runs = baseRuns().map((r) => (r.text === 'LMIX29524002' && r.y === 332 ? { ...r, text: 'LMIX_WRONG_ARTWORK_COPY' } : r));
    const result = await parse(runs);
    expect(result.licenseStyleLmix.value).toBe('LMIX29524002');
  });

  it('does not guess when more than one distinct standalone LMIX-shaped value appears in the header region', async () => {
    const runs = baseRuns().filter((r) => r.text !== 'License Style');
    // A second, different standalone LMIX-shaped item elsewhere in the
    // header region — genuinely ambiguous, must not pick either one.
    runs.push({ text: 'LMIX99999999', x: 700, y: 542, fontSize: FIXTURE_FONT_SIZE });
    const result = await parse(runs);
    // Falls through past the (now-ambiguous) standalone-header check to the
    // table's Artwork column, which is still unambiguous in this fixture.
    expect(result.licenseStyleLmix.value).toBe('LMIX29524002');
  });

  it('does not merge an adjacent header-grid column value into a neighboring label\'s value', async () => {
    const result = await parse(baseRuns());
    // Order date and Shipment date sit on the same shared row, ~40pt apart
    // — a regression here would silently concatenate both dates into one.
    expect(result.orderDate.value).toBe('2025-08-15');
    expect(result.shipmentDate.value).toBe('2025-09-30');
  });

  it('flags a quantity mismatch between the size columns and the table Total as a warning, PARTIAL', async () => {
    const runs = baseRuns().map((r) => (r.text === '1008 Pcs' ? { ...r, text: '1200 Pcs' } : r));
    const result = await parse(runs);
    expect(result.parseStatus).toBe('PARTIAL');
    expect(result.quantitySumMatchesTotal).toBe(false);
    expect(result.warnings.some((w) => w.includes('sum to'))).toBe(true);
  });

  it('flags a Season/folder mismatch without failing the whole record', async () => {
    const result = await parse(baseRuns(), { sourceSeasonFolder: 'SS26' });
    expect(result.seasonFolderMismatch).toBe(true);
    expect(result.warnings.some((w) => w.includes('Season reads'))).toBe(true);
  });

  it('fails closed to FAILED (never throws) on a document missing the entire header/table — no speculative recovery', async () => {
    const result = await parse([{ text: 'Unrelated content only', x: 20, y: 400 }]);
    expect(result.parseStatus).toBe('FAILED');
    expect(result.legacyReferenceNumber.value).toBeNull();
    expect(result.sizeQuantities).toEqual([]);
  });

  it('fails closed to FAILED on a genuinely corrupt/unreadable file rather than throwing', async () => {
    const result = await parsePurchaseOrderBuffer({
      fileBuffer: Buffer.from('this is not a pdf'),
      sourceFileName: 'corrupt.pdf',
      relativePath: 'corrupt.pdf',
      sourceSizeBytes: 18,
      sourceSeasonFolder: 'AW25',
    });
    expect(result.parseStatus).toBe('FAILED');
    expect(result.warnings.some((w) => w.includes('Unreadable/corrupt'))).toBe(true);
  });

  it('never assumes a fixed size set — reads whatever size-header codes are present', async () => {
    const runs = baseRuns()
      .filter((r) => !['3', '4', '5', '6', '7', '8'].includes(r.text) || r.y !== 346)
      .filter((r) => r.text !== '168');
    runs.push(
      { text: 'S', x: 350, y: 346, fontSize: FIXTURE_FONT_SIZE },
      { text: 'M', x: 401, y: 346, fontSize: FIXTURE_FONT_SIZE },
      { text: 'L', x: 423, y: 346, fontSize: FIXTURE_FONT_SIZE },
      { text: '200', x: 348, y: 322, fontSize: FIXTURE_FONT_SIZE },
      { text: '300', x: 399, y: 322, fontSize: FIXTURE_FONT_SIZE },
      { text: '400', x: 420, y: 322, fontSize: FIXTURE_FONT_SIZE },
    );
    runs.push({ text: '900 Pcs', x: 488, y: 322, fontSize: FIXTURE_FONT_SIZE });
    const withoutOldTotal = runs.filter((r) => r.text !== '1008 Pcs');
    const result = await parse(withoutOldTotal);
    expect(result.sizeQuantities.map((s) => s.sizeCode)).toEqual(['S', 'M', 'L']);
    expect(result.sizeQuantities.map((s) => s.quantity)).toEqual([200, 300, 400]);
    expect(result.tableTotalQuantity.value).toBe(900);
  });
});
