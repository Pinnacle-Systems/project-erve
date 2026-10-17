import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { JobOrderListDocument } from './JobOrderListDocument.js';
import type { JobOrderListPdfRow, JobOrderListPdfViewModel } from './buildJobOrderListViewModel.js';

function makeRow(overrides: Partial<JobOrderListPdfRow> = {}): JobOrderListPdfRow {
  return {
    id: 'jo-1',
    jobOrderNumber: 'EIJO/26-27/0001',
    styleDisplay: 'STY-0001 Basic Tee',
    factoryName: 'Acme Factory',
    sourceOrderSheetCount: 2,
    requiredDeliveryDate: '01 Jun 2026',
    orderedQuantityTotal: 1000,
    preparedQuantityTotal: 400,
    status: 'Sewing',
    ...overrides,
  };
}

function makeViewModel(rows: JobOrderListPdfRow[]): JobOrderListPdfViewModel {
  return {
    title: 'JOB ORDER LIST',
    subtitle: 'Factory production orders created from Order Sheet demand',
    filters: [],
    generatedAt: '2026-09-12T10:00:00Z',
    generatedBy: 'Test Admin',
    totalCount: rows.length,
    rows,
  };
}

describe('JobOrderListDocument', () => {
  it('renders with zero rows without throwing', async () => {
    const blob = await pdf(<JobOrderListDocument viewModel={makeViewModel([])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders a single row without throwing', async () => {
    const blob = await pdf(
      <JobOrderListDocument viewModel={makeViewModel([makeRow()])} />,
    ).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders mixed statuses including Production Complete without throwing', async () => {
    const rows = [makeRow(), makeRow({ id: 'jo-2', status: 'Production Complete' })];
    const blob = await pdf(<JobOrderListDocument viewModel={makeViewModel(rows)} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a row with no delivery date as an em dash without throwing', async () => {
    const rows = [makeRow({ requiredDeliveryDate: '' })];
    const blob = await pdf(<JobOrderListDocument viewModel={makeViewModel(rows)} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many rows spanning multiple API and PDF pages without throwing', async () => {
    const rows = Array.from({ length: 120 }, (_, i) =>
      makeRow({ id: `jo-${i}`, jobOrderNumber: `EIJO/26-27/${String(i).padStart(4, '0')}` }),
    );
    const blob = await Promise.race([
      pdf(<JobOrderListDocument viewModel={makeViewModel(rows)} />).toBlob(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('PDF generation hung on a long Job Order list')), 8000),
      ),
    ]);
    expect(blob.size).toBeGreaterThan(0);
  }, 10000);
});

it('embeds a thumbnail beside each list Style and keeps missing and inconsistent fallbacks', async () => {
  const image = {
    dataUri: `data:image/png;base64,${(await fs.readFile(new URL('../../../../public/erve-logo.png', import.meta.url))).toString('base64')}`,
  };
  const instance = pdf(
    <JobOrderListDocument
      viewModel={makeViewModel([
        makeRow({ image }),
        makeRow({ id: 'missing', image: { placeholder: true } }),
        makeRow({ id: 'bad', image: { inconsistent: true } }),
      ])}
    />,
  );
  await instance.toBlob();
  interface Node {
    type?: string;
    value?: string;
    children?: Node[];
  }
  function nodes(node: Node): Node[] {
    return [node, ...(node.children ?? []).flatMap(nodes)];
  }
  const all = nodes((instance.container as { document: Node }).document);
  expect(all.filter((node) => node.type === 'IMAGE')).toHaveLength(1);
  expect(all.some((node) => node.value === 'Image unavailable')).toBe(true);
  expect(all.filter((node) => node.value === 'STY-0001 Basic Tee')).toHaveLength(3);
});
it('writes synthetic multi-Style list evidence', async () => {
  const directory = process.env.PR2B_PDF_EVIDENCE_DIR;
  if (!directory) return;
  await fs.mkdir(directory, { recursive: true });
  const image = {
    dataUri: `data:image/png;base64,${(await fs.readFile(new URL('../../../../public/erve-logo.png', import.meta.url))).toString('base64')}`,
  };
  for (const count of [3, 35]) {
    const vm = makeViewModel(
      Array.from({ length: count }, (_, i) =>
        makeRow({
          id: `jo-${i}`,
          jobOrderNumber: `SYNTHETIC/JO/${i + 1}`,
          styleDisplay: `STYLE-${i + 1} Synthetic cotton Tee`,
          image: i === 1 ? { placeholder: true } : i === 2 ? { inconsistent: true } : image,
        }),
      ),
    );
    const blob = await pdf(<JobOrderListDocument viewModel={vm} />).toBlob();
    await fs.writeFile(
      path.join(directory, `list-${count}.pdf`),
      Buffer.from(await blob.arrayBuffer()),
    );
  }
}, 30000);

it('prints the complete inconsistent-image label without ellipsis in the actual PDF', async () => {
  const blob = await pdf(
    <JobOrderListDocument
      viewModel={makeViewModel([makeRow({ image: { inconsistent: true } })])}
    />,
  ).toBlob();
  const task = getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    useSystemFonts: true,
  });
  try {
    const doc = await task.promise;
    const content = await (await doc.getPage(1)).getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join('');
    expect(text.replace(/[\s-]/g, '')).toContain('Imageunavailable');
    expect(text).not.toContain('\u2026');
  } finally {
    await task.destroy();
  }
});
