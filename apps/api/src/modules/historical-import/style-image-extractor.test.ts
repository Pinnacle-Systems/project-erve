// Unit tests for the style image extractor, built entirely against
// synthetic PDFs (H1 plan §23) — never real historic customer PDFs.
import { afterEach, describe, expect, it } from 'vitest';
import { buildSyntheticPdf, type SyntheticImage, type SyntheticTextRun } from './__fixtures__/synthetic-pdf.js';
import { openPdfDocumentSession, type PdfDocumentSession } from './pdf-document-session.js';
import { extractStyleImageCandidate } from './style-image-extractor.js';

/** The table header row the extractor's TEMPLATE_CROP fallback anchors on. */
const TABLE_HEADER_RUNS: SyntheticTextRun[] = [
  { text: 'Style', x: 23, y: 347, fontSize: 5 },
  { text: 'Colour', x: 53, y: 347, fontSize: 5 },
  { text: 'Description', x: 85, y: 347, fontSize: 5 },
  { text: 'Total', x: 484, y: 347, fontSize: 5 },
];

const openSessions: PdfDocumentSession[] = [];
async function open(bytes: Buffer): Promise<PdfDocumentSession> {
  const session = await openPdfDocumentSession(new Uint8Array(bytes));
  openSessions.push(session);
  return session;
}
afterEach(async () => {
  await Promise.all(openSessions.splice(0).map((s) => s.destroy()));
});

describe('extractStyleImageCandidate', () => {
  it('selects the largest image as EMBEDDED_IMAGE, ignoring small icon-sized images (never "largest wins" alone — it must also clear the area threshold)', async () => {
    const images: SyntheticImage[] = [
      // Five small "care symbol" icons, well under the area threshold.
      { x: 576, y: 503, width: 18, height: 12, pixelWidth: 40, pixelHeight: 27, rgb: [0, 0, 0] },
      { x: 601, y: 502, width: 14, height: 14, pixelWidth: 30, pixelHeight: 30, rgb: [0, 0, 0] },
      { x: 622, y: 500, width: 18, height: 14, pixelWidth: 40, pixelHeight: 32, rgb: [0, 0, 0] },
      { x: 644, y: 501, width: 23, height: 16, pixelWidth: 50, pixelHeight: 35, rgb: [0, 0, 0] },
      { x: 672, y: 500, width: 15, height: 15, pixelWidth: 33, pixelHeight: 33, rgb: [0, 0, 0] },
      // The garment photo — large, well over the threshold.
      { x: 482, y: 367, width: 100, height: 99, pixelWidth: 500, pixelHeight: 480, rgb: [230, 180, 200] },
    ];
    const pdf = buildSyntheticPdf(TABLE_HEADER_RUNS, { images });
    const session = await open(pdf);
    const candidate = await extractStyleImageCandidate(session);

    expect(candidate.method).toBe('EMBEDDED_IMAGE');
    expect(candidate.imageBytes).not.toBeNull();
    expect(candidate.sha256).toMatch(/^[0-9a-f]{64}$/);
    // Aspect ratio preserved (500x480 native → downscaled to fit MAX_OUTPUT_DIMENSION, but not distorted).
    expect(candidate.widthPx! / candidate.heightPx!).toBeCloseTo(500 / 480, 1);
  });

  it('falls back to TEMPLATE_CROP, anchored on the table header, when no image clears the area threshold', async () => {
    const images: SyntheticImage[] = [
      { x: 576, y: 503, width: 18, height: 12, pixelWidth: 40, pixelHeight: 27, rgb: [0, 0, 0] },
    ];
    const pdf = buildSyntheticPdf(TABLE_HEADER_RUNS, { images });
    const session = await open(pdf);
    const candidate = await extractStyleImageCandidate(session);

    expect(candidate.method).toBe('TEMPLATE_CROP');
    expect(candidate.imageBytes).not.toBeNull();
    expect(candidate.notes.some((n) => n.includes('falling back to template crop'))).toBe(true);
  });

  it('falls back to TEMPLATE_CROP when the page has no images at all (flattened/scanned document)', async () => {
    const pdf = buildSyntheticPdf(TABLE_HEADER_RUNS);
    const session = await open(pdf);
    const candidate = await extractStyleImageCandidate(session);

    expect(candidate.method).toBe('TEMPLATE_CROP');
    expect(candidate.imageBytes).not.toBeNull();
    expect(candidate.notes.some((n) => n.includes('flattened/scanned'))).toBe(true);
  });

  it('reports MANUAL_REVIEW when neither an image nor the table-header anchor can be located', async () => {
    const pdf = buildSyntheticPdf([{ text: 'Unrelated content only', x: 20, y: 400, fontSize: 5 }]);
    const session = await open(pdf);
    const candidate = await extractStyleImageCandidate(session);

    expect(candidate.method).toBe('MANUAL_REVIEW');
    expect(candidate.imageBytes).toBeNull();
    expect(candidate.sha256).toBeNull();
  });

  it('produces a stable, deterministic hash for identical candidate output', async () => {
    const images: SyntheticImage[] = [
      { x: 482, y: 367, width: 100, height: 99, pixelWidth: 500, pixelHeight: 480, rgb: [10, 20, 30] },
    ];
    const pdfBytes1 = buildSyntheticPdf(TABLE_HEADER_RUNS, { images });
    const pdfBytes2 = buildSyntheticPdf(TABLE_HEADER_RUNS, { images });
    const [session1, session2] = await Promise.all([open(pdfBytes1), open(pdfBytes2)]);
    const [candidate1, candidate2] = await Promise.all([
      extractStyleImageCandidate(session1),
      extractStyleImageCandidate(session2),
    ]);
    expect(candidate1.sha256).toBe(candidate2.sha256);
  });
});
