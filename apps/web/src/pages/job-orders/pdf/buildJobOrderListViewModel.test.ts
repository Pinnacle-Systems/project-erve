import fs from 'node:fs/promises';
import path from 'node:path';
import { pdf } from '@react-pdf/renderer';
import { JobOrderListDocument } from './JobOrderListDocument.js';
import { describe, expect, it } from 'vitest';
import type { JobOrder } from '../types.js';
import { buildJobOrderListViewModel } from './buildJobOrderListViewModel.js';

function makeJobOrder(overrides: Partial<JobOrder> = {}): JobOrder {
  return {
    id: 'jo-1',
    jobOrderNumber: 'EIJO/26-27/0001',
    primaryStyle: {
      consistent: true,
      style: { id: 'style-1', styleNumber: 'STY-0001', styleName: 'Basic Tee', primaryImage: null },
    },
    financialYear: { id: 'fy1', code: '2026-27' },
    factory: { id: 'f1', code: 'F1', name: 'Acme Factory' },
    unitPrice: 100,
    status: 'IN_PRODUCTION',
    operationalState: {
      lifecycleContext: {
        code: 'IN_PRODUCTION',
        label: 'In Production',
        tone: 'info',
        activityId: null,
        activityName: null,
      },
      productionState: {
        code: 'SEWING',
        label: 'Sewing',
        tone: 'info',
        activityId: 'a1',
        activityName: 'Sewing',
      },
      qualityState: null,
      primaryDisplayState: {
        code: 'SEWING',
        label: 'Sewing',
        tone: 'info',
        activityId: 'a1',
        activityName: 'Sewing',
      },
    },
    factoryConfirmationStatus: 'CONFIRMED',
    requiredDeliveryDate: '2026-06-01T00:00:00.000Z',
    deliveryDateLocked: true,
    isDelayed: false,
    orderedQuantityTotal: 1000,
    preparedQuantityTotal: 400,
    sourceOrderSheetCount: 2,
    createdAt: '2026-04-01T00:00:00.000Z',
    version: 1,
    updatedAt: '2026-04-01T00:00:00.000Z',
    seasonSnapshots: [],
    processFlowVersion: {
      id: 'pfv1',
      versionNumber: 1,
      status: 'ACTIVE',
      processFlow: { id: 'pf1', code: 'PF1', name: 'Standard Flow' },
    },
    confirmedBy: null,
    confirmedAt: null,
    disclaimerText: null,
    disclaimerRevision: 0,
    acknowledgement: null,
    acknowledgements: [],
    productionStartedAt: '2026-04-15T00:00:00.000Z',
    productionCompletedAt: null,
    creator: { id: 'u1', name: 'Test User', email: 'test@erve.local' },
    lines: [
      {
        id: 'line-1',
        styleId: 'style-1',
        styleNumber: 'STY-0001',
        styleName: 'Basic Tee',
        primaryImage: null,
        orderedQuantityTotal: 1000,
        preparedQuantityTotal: 400,
        status: 'IN_PRODUCTION',
        sizes: [],
      },
    ],
    stages: [],
    qualityActivities: [],
    reworkTasks: [],
    ...overrides,
  };
}

describe('buildJobOrderListViewModel', () => {
  it('produces a "Job Order" title and zero rows for an empty list', () => {
    const vm = buildJobOrderListViewModel([], {}, { generatedAt: '2026-09-12T10:00:00Z' });
    expect(vm.title).toBe('JOB ORDER LIST');
    expect(vm.rows).toEqual([]);
    expect(vm.totalCount).toBe(0);
  });

  it('maps Style, Factory, quantities, Order Sheet count and current status for a single row', () => {
    const vm = buildJobOrderListViewModel(
      [makeJobOrder()],
      {},
      { generatedAt: '2026-09-12T10:00:00Z' },
    );
    expect(vm.rows[0]).toMatchObject({
      id: 'jo-1',
      jobOrderNumber: 'EIJO/26-27/0001',
      styleDisplay: 'STY-0001 Basic Tee',
      factoryName: 'Acme Factory',
      sourceOrderSheetCount: 2,
      requiredDeliveryDate: '01 Jun 2026',
      orderedQuantityTotal: 1000,
      preparedQuantityTotal: 400,
      status: 'Sewing',
    });
  });

  it('appends a Delayed indicator without inventing a new lifecycle status', () => {
    const jobOrder = makeJobOrder({ isDelayed: true });
    const vm = buildJobOrderListViewModel([jobOrder], {}, { generatedAt: '2026-09-12T10:00:00Z' });
    expect(vm.rows[0]?.status).toBe('Sewing (Delayed)');
  });

  it('represents a PRODUCTION_COMPLETE Job Order using its authoritative persisted status label', () => {
    const jobOrder = makeJobOrder({
      status: 'PRODUCTION_COMPLETE',
      operationalState: {
        lifecycleContext: {
          code: 'PRODUCTION_COMPLETE',
          label: 'Production Complete',
          tone: 'success',
          activityId: null,
          activityName: null,
        },
        productionState: null,
        qualityState: null,
        primaryDisplayState: {
          code: 'PRODUCTION_COMPLETE',
          label: 'Production Complete',
          tone: 'success',
          activityId: null,
          activityName: null,
        },
      },
    });
    const vm = buildJobOrderListViewModel([jobOrder], {}, { generatedAt: '2026-09-12T10:00:00Z' });
    expect(vm.rows[0]?.status).toBe('Production Complete');
  });

  it('never invents a Closed lifecycle label for a Job Order that has not reached it', () => {
    const vm = buildJobOrderListViewModel(
      [makeJobOrder()],
      {},
      { generatedAt: '2026-09-12T10:00:00Z' },
    );
    expect(vm.rows[0]?.status.toLowerCase()).not.toContain('closed');
  });

  it('preserves row order as given (server order), not re-sorted', () => {
    const jobOrderA = makeJobOrder({ id: 'jo-1' });
    const jobOrderB = makeJobOrder({ id: 'jo-2' });
    const vm = buildJobOrderListViewModel(
      [jobOrderA, jobOrderB],
      {},
      { generatedAt: '2026-09-12T10:00:00Z' },
    );
    expect(vm.rows.map((r) => r.id)).toEqual(['jo-1', 'jo-2']);
  });

  it('renders every declared filter as an active chip value', () => {
    const vm = buildJobOrderListViewModel(
      [],
      {
        search: 'EIJO',
        status: 'IN_PRODUCTION',
        factoryName: 'Acme Factory',
        financialYearLabel: '26-27',
      },
      { generatedAt: '2026-09-12T10:00:00Z' },
    );
    expect(vm.filters).toEqual([
      { label: 'Search', value: 'EIJO' },
      { label: 'Status', value: 'In Production' },
      { label: 'Factory', value: 'Acme Factory' },
      { label: 'Financial Year', value: '26-27' },
    ]);
  });

  it('does not leak unrelated/internal properties into the printable row', () => {
    const jobOrder = {
      ...makeJobOrder(),
      __internalDebugFlag: true,
      someAuditInternal: 'secret',
    } as JobOrder;
    const vm = buildJobOrderListViewModel([jobOrder], {}, { generatedAt: '2026-09-12T10:00:00Z' });
    const serialized = JSON.stringify(vm.rows[0]);
    expect(serialized).not.toContain('__internalDebugFlag');
    expect(serialized).not.toContain('someAuditInternal');
  });

  it("prints Not recorded for a historical import's prepared quantity but keeps live values, including a recorded 0", () => {
    const vm = buildJobOrderListViewModel(
      [
        makeJobOrder({
          id: 'hist',
          status: 'PRODUCTION_COMPLETE',
          factoryConfirmationStatus: 'PENDING',
          preparedQuantityTotal: 0,
          historicalImport: {
            legacyReferenceNumber: 'EI26016',
            historicalBusinessDate: '2026-02-25',
            importedAt: '2026-09-24T00:00:00Z',
          },
        }),
        makeJobOrder({ id: 'live-zero', preparedQuantityTotal: 0, historicalImport: null }),
        makeJobOrder({ id: 'live-prepared', preparedQuantityTotal: 1008 }),
      ],
      {},
      { generatedAt: '2026-09-12T10:00:00Z' },
    );
    expect(vm.rows.map((r) => [r.id, r.preparedQuantityTotal])).toEqual([
      ['hist', 'Not recorded'],
      ['live-zero', 0],
      ['live-prepared', 1008],
    ]);
  });
});

it('does not guess a Style identity for conflicting or empty legacy lines', () => {
  const valid = makeJobOrder();
  const cases = [
    makeJobOrder({
      lines: [valid.lines[0]!, { ...valid.lines[0]!, styleId: 'other', styleNumber: 'OTHER' }],
      primaryStyle: { consistent: false },
    }),
    makeJobOrder({ lines: [], primaryStyle: { consistent: false } }),
    makeJobOrder({ lines: [] }),
    makeJobOrder({
      lines: [valid.lines[0]!, { ...valid.lines[0]!, styleId: 'other', styleNumber: 'OTHER' }],
    }),
    makeJobOrder({
      primaryStyle: {
        consistent: true,
        style: { id: 'other', styleNumber: 'WRONG', styleName: 'Wrong', primaryImage: null },
      },
    }),
    makeJobOrder({ primaryStyle: { consistent: false } }),
  ];
  for (const record of cases) {
    const row = buildJobOrderListViewModel(
      [record],
      {},
      { generatedAt: '2026-09-12T10:00:00Z' },
      new Map([[record.id, { dataUri: 'wrong-image' }]]),
    ).rows[0]!;
    expect(row.styleDisplay).toBe('Unavailable');
    expect(row.image).toEqual({ inconsistent: true });
  }
});
it('uses the validated authoritative Style label and its associated resolved image', () => {
  const image = { dataUri: 'correct-image' };
  const record = makeJobOrder({
    primaryStyle: {
      consistent: true,
      style: {
        id: 'style-1',
        styleNumber: 'AUTHORITATIVE',
        styleName: 'Current identity',
        primaryImage: null,
      },
    },
  });
  const row = buildJobOrderListViewModel(
    [record],
    {},
    { generatedAt: '2026-09-12T10:00:00Z' },
    new Map([[record.id, image]]),
  ).rows[0]!;
  expect(row.styleDisplay).toBe('AUTHORITATIVE Current identity');
  expect(row.image).toEqual(image);
});

it('writes validated Style identity PDFs for independent visual review', async () => {
  const directory = process.env.PR2B_PDF_EVIDENCE_DIR;
  if (!directory) return;
  await fs.mkdir(directory, { recursive: true });
  const valid = makeJobOrder();
  const cases = [
    { name: 'identity-valid', record: valid },
    {
      name: 'identity-empty',
      record: makeJobOrder({ lines: [], primaryStyle: { consistent: false } }),
    },
    {
      name: 'identity-inconsistent',
      record: makeJobOrder({
        lines: [
          valid.lines[0]!,
          { ...valid.lines[0]!, styleId: 'other', styleNumber: 'MUST-NOT-PRINT' },
        ],
        primaryStyle: { consistent: false },
      }),
    },
    {
      name: 'long-style-list',
      record: makeJobOrder({
        primaryStyle: {
          consistent: true,
          style: {
            id: 'style-1',
            styleNumber: 'SYNTHETIC-LONG-STYLE-2026-001',
            styleName:
              'Long synthetic Style name with extended fabric construction colour and garment description for wrapping verification across the printable row',
            primaryImage: null,
          },
        },
      }),
    },
  ];
  for (const { name, record } of cases) {
    const vm = buildJobOrderListViewModel([record], {}, { generatedAt: '2026-09-12T10:00:00Z' });
    const blob = await pdf(JobOrderListDocument({ viewModel: vm })).toBlob();
    await fs.writeFile(path.join(directory, `${name}.pdf`), Buffer.from(await blob.arrayBuffer()));
  }
});
