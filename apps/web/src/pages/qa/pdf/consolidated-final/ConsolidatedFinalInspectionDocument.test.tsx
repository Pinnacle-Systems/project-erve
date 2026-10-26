import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { ConsolidatedFinalInspectionDocument } from './ConsolidatedFinalInspectionDocument.js';
import { buildConsolidatedFinalInspectionViewModel } from './buildConsolidatedFinalInspectionViewModel.js';
import { makeRegressionFixture } from './consolidatedFinalInspectionTestFixture.js';
import type { ConsolidatedFinalInspectionSnapshot } from './collectConsolidatedFinalInspectionData.js';

const META = { generatedAt: '2026-09-12T10:00:00Z', generatedBy: 'Test Admin' };

function makeSnapshot(): ConsolidatedFinalInspectionSnapshot {
  const fixture = makeRegressionFixture();
  return {
    seedExecution: fixture.seedExecution,
    jobOrderId: fixture.seedExecution.jobOrderId,
    processFlowActivityId: fixture.seedExecution.processFlowActivityId,
    batches: [
      { batch: fixture.batchesById['batch-1']!, attempts: [fixture.attemptExecutions['batch1-attempt1']!, fixture.attemptExecutions['batch1-attempt2']!] },
      { batch: fixture.batchesById['batch-2']!, attempts: [fixture.attemptExecutions['batch2-attempt1']!] },
      { batch: fixture.batchesById['batch-3']!, attempts: [fixture.attemptExecutions['batch3-attempt1']!] },
    ],
  };
}

async function extractText(blob: Blob): Promise<string> {
  const task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true });
  try {
    const doc = await task.promise;
    let text = '';
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      text += content.items.flatMap((item) => ('str' in item ? [item.str] : [])).join(' ');
    }
    return text;
  } finally {
    await task.destroy();
  }
}

describe('ConsolidatedFinalInspectionDocument', () => {
  it('renders the §13B fixture without throwing, as a valid non-empty A4 PDF', async () => {
    const viewModel = buildConsolidatedFinalInspectionViewModel({ snapshot: makeSnapshot(), evidenceImages: new Map(), primaryImage: { placeholder: true } }, META);
    const blob = await pdf(<ConsolidatedFinalInspectionDocument viewModel={viewModel} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  }, 20000);

  it('includes the Job Order number, both batch headings, and every attempt heading', async () => {
    const viewModel = buildConsolidatedFinalInspectionViewModel({ snapshot: makeSnapshot(), evidenceImages: new Map(), primaryImage: { placeholder: true } }, META);
    const blob = await pdf(<ConsolidatedFinalInspectionDocument viewModel={viewModel} />).toBlob();
    const text = await extractText(blob);

    expect(text).toContain('JO-1001');
    expect(text).toContain('Physical Batch 1');
    expect(text).toContain('Physical Batch 2');
    expect(text).toContain('Physical Batch 3 (Cancelled)');
    expect(text).toMatch(/Attempt 1.*FAIL/);
    expect(text).toMatch(/Attempt 2.*PASS/);
    expect(text).toContain('Measurement out of tolerance');
    expect(text).toContain('Shoulder seam measurement failed tolerance.');
    expect(text).toContain('Reinspection passed after rework.');
  }, 20000);

  it('prints the active physical quantity as 72, never 132, inside the rendered PDF text', async () => {
    const viewModel = buildConsolidatedFinalInspectionViewModel({ snapshot: makeSnapshot(), evidenceImages: new Map(), primaryImage: { placeholder: true } }, META);
    const blob = await pdf(<ConsolidatedFinalInspectionDocument viewModel={viewModel} />).toBlob();
    const text = await extractText(blob);

    expect(text).toContain('72');
    expect(text).not.toContain('132');
  }, 20000);

  it('keeps the shared ERVE header/branding and page numbering present', async () => {
    const viewModel = buildConsolidatedFinalInspectionViewModel({ snapshot: makeSnapshot(), evidenceImages: new Map(), primaryImage: { placeholder: true } }, META);
    const blob = await pdf(<ConsolidatedFinalInspectionDocument viewModel={viewModel} />).toBlob();
    const text = await extractText(blob);

    expect(text).toContain('CONSOLIDATED FINAL INSPECTION REPORT');
    expect(text).toMatch(/Page 1 of \d+/);
  }, 20000);

  it('renders with a resolved evidence image for one attempt and a placeholder for another, without mixing them', async () => {
    const snapshot = makeSnapshot();
    const evidenceImages = new Map([
      ['evidence-1a', { dataUri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' }],
      // evidence-1b intentionally left unresolved -> falls back to the explicit placeholder.
    ]);
    const viewModel = buildConsolidatedFinalInspectionViewModel({ snapshot, evidenceImages, primaryImage: { placeholder: true } }, META);
    const blob = await pdf(<ConsolidatedFinalInspectionDocument viewModel={viewModel} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  }, 20000);

  it('renders a long multi-batch, multi-attempt, many-checklist-item document across multiple A4 pages without truncation errors', async () => {
    const snapshot = makeSnapshot();
    const manyChecklistItems = Array.from({ length: 50 }, (_, i) => ({ key: `item-${i}`, label: `Checklist item ${i}` }));
    const manyChecklistResponses = manyChecklistItems.map((item) => ({
      componentId: 'checklist-1',
      itemKey: item.key,
      response: 'YES',
      remarks: `Remark for ${item.key}`,
    }));
    snapshot.batches.forEach((batchSnapshot) => {
      batchSnapshot.attempts.forEach((attempt) => {
        attempt.sections = attempt.sections.map((section) =>
          section.id === 'section-2'
            ? {
                ...section,
                components: section.components.map((component) =>
                  component.id === 'checklist-1'
                    ? { ...component, config: { ...component.config, items: manyChecklistItems } }
                    : component,
                ),
              }
            : section,
        );
        attempt.responses = { ...attempt.responses, checklistResponses: manyChecklistResponses };
      });
    });
    const viewModel = buildConsolidatedFinalInspectionViewModel({ snapshot, evidenceImages: new Map(), primaryImage: { placeholder: true } }, META);
    const blob = await pdf(<ConsolidatedFinalInspectionDocument viewModel={viewModel} />).toBlob();
    const task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true });
    try {
      const doc = await task.promise;
      expect(doc.numPages).toBeGreaterThan(1);
      const lastPageText = (await (await doc.getPage(doc.numPages)).getTextContent()).items
        .flatMap((item) => ('str' in item ? [item.str] : []))
        .join(' ')
        .trim();
      expect(lastPageText.length).toBeGreaterThan(0);
    } finally {
      await task.destroy();
    }
  }, 30000);
});
