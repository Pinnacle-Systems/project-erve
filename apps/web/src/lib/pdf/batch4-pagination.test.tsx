import { pdf, View } from '@react-pdf/renderer';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { PdfDocument } from './core/PdfDocument.js';
import { PdfHeader } from './core/PdfHeader.js';
import { PdfFooter } from './core/PdfFooter.js';
import { QualityBlocksRenderer } from '../../pages/qa/pdf/shared/QualityBlocksRenderer.js';
import { PpSampleDocument } from '../../pages/qa/pdf/pp-sample/PpSampleDocument.js';
import { buildPpSampleViewModel } from '../../pages/qa/pdf/pp-sample/buildPpSampleViewModel.js';
import { makeQaInspectionDetail } from '../../pages/qa/pdf/pp-sample/ppSampleTestFixture.js';
import { renderErvePackingListDetailPdfBlob } from '../../pages/fulfillment/pdf/erve-packing-list/renderErvePackingListDetailPdf.js';
import { QualityExecutionDocument } from '../../pages/qa/pdf/execution/QualityExecutionDocument.js';
import { buildQualityExecutionViewModel } from '../../pages/qa/pdf/execution/buildQualityExecutionViewModel.js';
import { makeQualityExecutionView } from '../../pages/qa/pdf/execution/qualityExecutionTestFixture.js';
import { verifyPackingListPdf } from '../../pages/fulfillment/pdf/erve-packing-list/verifyErvePackingListPdf.test-utils.js';
import { packingListFixture } from '../../pages/fulfillment/pdf/erve-packing-list/ervePackingListPdf.test-utils.js';

const meta = { generatedAt: '2026-10-22T10:00:00Z', generatedBy: 'Synthetic QA' };
type Item = { str: string; x: number; y: number; width: number; height: number };
async function inspect(blob: Blob, name: string): Promise<Item[][]> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const output = process.env.BATCH4_PDF_EVIDENCE_DIR;
  if (output) {
    await mkdir(output, { recursive: true });
    await writeFile(resolve(output, `${name}.pdf`), bytes);
  }
  const task = getDocument({ data: bytes.slice(), useSystemFonts: true });
  try {
    const doc = await task.promise;
    const pages: Item[][] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(
        content.items.flatMap((item) =>
          'str' in item
            ? [
                {
                  str: item.str,
                  x: item.transform[4]!,
                  y: item.transform[5]!,
                  width: item.width,
                  height: item.height,
                },
              ]
            : [],
        ),
      );
    }
    if (output) await writeFile(resolve(output, `${name}.json`), JSON.stringify(pages, null, 2));
    return pages;
  } finally {
    await task.destroy();
  }
}
const text = (page: Item[]) => page.map((item) => item.str).join(' ');
const body = (page: Item[]) =>
  page.filter((item) => item.str.trim() && item.y > 38 && item.y < 525);

it.each([420, 435, 445])(
  'keeps Final context heading with its first meaningful value near boundary %s',
  async (height) => {
    const blob = await pdf(
      <PdfDocument orientation="landscape">
        <PdfHeader title="FINAL INSPECTION" />
        <View style={{ height }} />
        <QualityBlocksRenderer
          sections={[
            {
              id: 's',
              title: 'Inspection Context',
              blocks: [
                {
                  kind: 'grid',
                  heading: 'Report fields',
                  items: [{ label: 'Inspector', value: 'CONTEXT-SENTINEL' }],
                },
              ],
            },
          ]}
        />
        <PdfFooter />
      </PdfDocument>,
    ).toBlob();
    const pages = await inspect(blob, `final-heading-${height}`);
    const heading = pages.find((page) => text(page).includes('Inspection Context'))!;
    expect(text(heading)).toContain('CONTEXT-SENTINEL');
  },
);

it('flows a long PP checklist without clipped or missing inspection rows', async () => {
  const detail = makeQaInspectionDetail();
  const model = buildPpSampleViewModel(
    { detail, evidenceImages: new Map(), primaryImage: { placeholder: true } },
    meta,
  );
  model.sessions[0]!.forms[0]!.evidence = [];
  model.sessions[0]!.forms[0]!.checklist = Array.from({ length: 60 }, (_, n) => ({
    label: `CHECKPOINT-${String(n).padStart(2, '0')}`,
    status: 'Yes',
    remarks: `Recorded remark ${n}`,
  }));
  const pages = await inspect(
    await pdf(<PpSampleDocument viewModel={model} />).toBlob(),
    'pp-long',
  );
  expect(pages.length).toBeGreaterThan(1);
  for (let n = 0; n < 60; n++) {
    const hits = pages
      .flat()
      .filter((item) => item.str === `CHECKPOINT-${String(n).padStart(2, '0')}`);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.y).toBeGreaterThanOrEqual(40);
    expect(hits[0]!.y).toBeLessThan(525);
  }
  for (const page of pages) {
    if (page.some((item) => item.str.startsWith('CHECKPOINT-')))
      expect(text(page)).toContain('Checklist Item');
  }
});

it('keeps Inline conclusion and sign-off together at a page boundary', async () => {
  const blob = await pdf(
    <PdfDocument orientation="landscape">
      <PdfHeader title="INLINE INSPECTION" />
      <View style={{ height: 425 }} />
      <QualityBlocksRenderer
        sections={[
          {
            id: 'conclusion',
            title: 'Conclusion',
            blocks: [
              {
                kind: 'text',
                heading: 'Inspection conclusion',
                value: 'All recorded checks complete.',
              },
              {
                kind: 'grid',
                heading: 'Sign-off',
                items: [{ label: 'Inspector', value: 'SIGNOFF-SENTINEL' }],
              },
            ],
          },
        ]}
      />
      <PdfFooter />
    </PdfDocument>,
  ).toBlob();
  const pages = await inspect(blob, 'inline-conclusion');
  expect(text(pages.find((page) => text(page).includes('Inspection conclusion'))!)).toContain(
    'SIGNOFF-SENTINEL',
  );
});

it('keeps EIPL boundary totals with meaningful Style rows', async () => {
  // Sweep the existing public worker rendering pipeline across neighboring boundaries.
  for (const styles of Array.from({ length: 36 }, (_, i) => i + 1)) {
    const source = packingListFixture(1, styles, 3);
    const pages = await inspect(
      await renderErvePackingListDetailPdfBlob(source, meta),
      `eipl-${styles}`,
    );
    for (const page of pages) {
      const content = body(page);
      if (content.some((item) => item.str === 'Total' || item.str.startsWith('Total:'))) {
        expect(
          content.some((item) => item.str.startsWith('ST-')),
          text(page),
        ).toBe(true);
      }
    }
  }
}, 60000);

it.each([false, true])(
  'preserves Final inspection attempts and supported evidence (with evidence: %s)',
  async (evidence) => {
    const execution = makeQualityExecutionView({
      activityName: 'Final Inspection',
      attachments: [],
    });
    execution.finalBatch = {
      id: 'batch-2',
      batchNumber: 2,
      physicalQuantity: 72,
      disposition: 'RELEASED',
      allocations: [],
      attempts: [1, 2, 3].map((n) => ({
        id: `attempt-${n}`,
        attemptNumber: n,
        status: 'FINALIZED',
        outcome: n === 3 ? 'PASS' : 'FAIL',
        rejectionReason: n === 3 ? null : `RECORDED-DEFECT-${n}`,
        startedAt: '2026-01-10T09:00:00Z',
        finalizedAt: '2026-01-10T10:00:00Z',
      })),
      release: { id: 'release', quantity: 72, releasedAt: '2026-01-10T11:00:00Z' },
    };
    const images = new Map<string, { dataUri: string }>();
    if (evidence) {
      execution.attachments = [
        {
          id: 'attachment-1',
          componentId: 'attachments-1',
          requirementKey: 'photo',
          fileName: 'supported-evidence.png',
          contentType: 'image/png',
          sizeBytes: 68,
          createdAt: '2026-01-10T10:00:00Z',
        },
      ];
      // Match the existing fixture's supported attachment requirement, retaining association.
      const attachment = execution.sections
        .flatMap((section) => section.components)
        .find((component) => component.type === 'ATTACHMENTS')!;
      const requirements = attachment.config.requirements;
      if (!Array.isArray(requirements) || !requirements[0] || typeof requirements[0] !== 'object')
        throw Error('Fixture missing requirement');
      execution.attachments[0]!.componentId = attachment.id;
      execution.attachments[0]!.requirementKey = String(requirements[0].key);
      images.set('attachment-1', {
        dataUri:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      });
    }
    const model = buildQualityExecutionViewModel(
      { execution, evidenceImages: images, primaryImage: { placeholder: true } },
      meta,
    );
    const pages = await inspect(
      await pdf(<QualityExecutionDocument viewModel={model} />).toBlob(),
      `final-attempts-${evidence ? 'evidence' : 'no-evidence'}`,
    );
    const all = pages.map(text).join(' ');
    expect(all.match(/RECORDED-DEFECT-1/g)).toHaveLength(1);
    expect(all.match(/RECORDED-DEFECT-2/g)).toHaveLength(1);
    expect(all).toContain('72 units released downstream');
    if (evidence) expect(all.match(/supported-evidence.png/g)).toHaveLength(1);
    else expect(all).not.toContain('supported-evidence.png');
  },
);

it('exports a short PP record without an availability-only page', async () => {
  const model = buildPpSampleViewModel(
    {
      detail: makeQaInspectionDetail(),
      evidenceImages: new Map(),
      primaryImage: { placeholder: true },
    },
    meta,
  );
  const pages = await inspect(
    await pdf(<PpSampleDocument viewModel={model} />).toBlob(),
    'pp-short',
  );
  expect(pages.map(text).join(' ')).not.toMatch(/Downstream Availability|downstream-ready/);
  expect(pages.length).toBeLessThanOrEqual(2);
  for (const page of pages) expect(body(page).length).toBeGreaterThan(2);
});


it('keeps PP evidence filenames with their images across multiple forms and cycles', async () => {
  const model = buildPpSampleViewModel({ detail: makeQaInspectionDetail(), evidenceImages: new Map(), primaryImage: { placeholder: true } }, meta);
  const base = model.sessions[0]!;
  const image = { dataUri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' };
  model.sessions = [1, 2].map(cycle => ({ ...base, id: `cycle-${cycle}`, cycleLabel: `Cycle ${cycle}`, forms: [1, 2].map(form => ({ ...base.forms[0]!, id: `form-${cycle}-${form}`, sizeLabel: `SIZE-${cycle}-${form}`, checklist: Array.from({ length: 12 }, (_, n) => ({ label: `C${cycle}F${form}-CHECK-${n}`, status: 'Yes', remarks: 'Recorded inspection' })), evidence: Array.from({ length: 12 }, (_, n) => ({ id: `image-${cycle}-${form}-${n}`, fileName: `EVIDENCE-C${cycle}F${form}-${n}.png`, contentType: 'image/png', sizeBytes: 68, isImage: true, image })) })) }));
  const blob = await pdf(<PpSampleDocument viewModel={model} />).toBlob();
  const pages = await inspect(blob, 'pp-multiple-cycles-evidence');
  const all = pages.map(text).join(' ');
  for (const cycle of [1, 2]) for (const form of [1, 2]) {
    for (let n = 0; n < 12; n++) {
      expect(all.split(`C${cycle}F${form}-CHECK-${n} `)).toHaveLength(2);
      expect(all.split(`EVIDENCE-C${cycle}F${form}-${n}.png`)).toHaveLength(2);
    }
  }
  const task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true });
  try {
    const doc = await task.promise;
    for (let n = 1; n <= doc.numPages; n++) {
      const names = pages[n - 1]!.filter(item => item.str.startsWith('EVIDENCE-')).length;
      if (!names) continue;
      const ops = await (await doc.getPage(n)).getOperatorList();
      const images = ops.fnArray.filter(op => [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat].includes(op)).length;
      expect(images).toBeGreaterThanOrEqual(names + 1); // one repeated branded logo plus these evidence cards
    }
  } finally { await task.destroy(); }
}, 30000);


it('preserves multi-carton and wide Style/Size data through the existing EIPL worker pipeline', async () => {
  const source = packingListFixture(3, 7, 11);
  const blob = await renderErvePackingListDetailPdfBlob(source, meta);
  await verifyPackingListPdf(blob, source);
  const pages = await inspect(blob, 'eipl-multiple-cartons');
  expect(pages.length).toBeGreaterThan(1);
  expect(pages.map(text).join(' ')).toContain('CTN-003');
}, 30000);
