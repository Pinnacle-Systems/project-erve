import { Document, Page, pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { PdfMetaSection } from './PdfMetaSection.js';

async function renderText(generatedBy: string | null | undefined): Promise<string> {
  // pdf(...).toString() dumps the raw PDF file structure (xref/trailer/etc. are literal text,
  // even though embedded content streams are compressed) — enough to prove a stray "undefined"/
  // "null"/"[object Object]" never leaks into the document. Despite its synchronous-looking type
  // signature, it resolves a Promise at runtime.
  return pdf(
    <Document>
      <Page size="A4">
        <PdfMetaSection generatedAt="2026-09-12T10:00:00Z" generatedBy={generatedBy} />
      </Page>
    </Document>,
  ).toString();
}

describe('PdfMetaSection generatedBy fallback', () => {
  it('omits the "by <name>" suffix entirely when generatedBy is undefined (no auth context)', async () => {
    const text = await renderText(undefined);
    expect(text).not.toMatch(/undefined/);
    expect(text).not.toMatch(/null/);
    expect(text).not.toMatch(/\[object Object\]/);
    expect(text).not.toMatch(/ by /);
  });

  it('omits the "by <name>" suffix entirely when generatedBy is null', async () => {
    const text = await renderText(null);
    expect(text).not.toMatch(/undefined/);
    expect(text).not.toMatch(/null/);
    expect(text).not.toMatch(/ by /);
  });
});
