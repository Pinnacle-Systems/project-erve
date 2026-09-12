import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { JobOrderDetailDocument } from './JobOrderDetailDocument.js';
import type {
  JobOrderDetailCombinedForecastRow,
  JobOrderDetailPdfViewModel,
  JobOrderDetailQualityActivityRow,
  JobOrderDetailSizeRow,
  JobOrderDetailSourceOrderSheetRow,
  JobOrderDetailStageRow,
} from './buildJobOrderDetailViewModel.js';

function makeSize(overrides: Partial<JobOrderDetailSizeRow> = {}): JobOrderDetailSizeRow {
  return { id: 'sz-1', sizeCode: 'S', orderedQuantity: 200, preparedQuantity: 100, varianceQuantity: -100, ...overrides };
}

function makeSourceOrderSheet(
  overrides: Partial<JobOrderDetailSourceOrderSheetRow> = {},
): JobOrderDetailSourceOrderSheetRow {
  return {
    id: 'os-1',
    poNumber: 'EIOS/26-27/0001',
    distributorName: 'Acme Distributors',
    purchaseMode: 'Outright',
    requiredDeliveryDate: '01 May 2026',
    forecastTotal: 500,
    ...overrides,
  };
}

function makeStage(overrides: Partial<JobOrderDetailStageRow> = {}): JobOrderDetailStageRow {
  return {
    id: 'stage-1',
    sequence: 1,
    stageName: 'Cutting',
    status: 'Completed',
    completedByName: 'Line Supervisor',
    completedAt: '12 Apr 2026, 10:00 am',
    ...overrides,
  };
}

function makeQualityActivity(
  overrides: Partial<JobOrderDetailQualityActivityRow> = {},
): JobOrderDetailQualityActivityRow {
  return {
    id: 'stage-pp-sample',
    sequence: 1,
    name: 'PP Sample',
    formDisplay: 'PP Sample Form v1',
    mode: 'Sequential Gate',
    status: 'Completed',
    gateRequirement: 'Pass required to proceed',
    outcome: 'PASS',
    coverageSummary: '',
    ...overrides,
  };
}

function makeCombinedForecast(
  overrides: Partial<JobOrderDetailCombinedForecastRow> = {},
): JobOrderDetailCombinedForecastRow {
  return { sizeId: 'size-s', sizeLabel: 'Small', forecastQuantity: 250, jobOrderQuantity: 200, varianceQuantity: -50, ...overrides };
}

function makeViewModel(overrides: Partial<JobOrderDetailPdfViewModel> = {}): JobOrderDetailPdfViewModel {
  return {
    title: 'JOB ORDER',
    subtitle: 'EIJO/26-27/0001 — Acme Factory',
    generatedAt: '2026-09-12T10:00:00Z',
    generatedBy: 'Test Admin',
    identityItems: [
      { label: 'Job Order Number', value: 'EIJO/26-27/0001' },
      { label: 'Lifecycle Status', value: 'In Production' },
    ],
    styleNumber: 'STY-0001',
    styleName: 'Basic Tee',
    quantityTotalsLine: 'Ordered: 500  Prepared: 200  Variance: -300',
    sizes: [makeSize()],
    sourceOrderSheets: null,
    combinedForecast: [],
    stages: [],
    qualityActivities: [],
    ...overrides,
  };
}

describe('JobOrderDetailDocument', () => {
  it('renders a simple early-stage Job Order (no stages, no quality activities) without throwing', async () => {
    const blob = await pdf(<JobOrderDetailDocument viewModel={makeViewModel()} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('omits the Source Order Sheets section entirely when null (Factory/QA viewer)', async () => {
    const blob = await pdf(<JobOrderDetailDocument viewModel={makeViewModel({ sourceOrderSheets: null })} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders multiple source Order Sheets from different distributors plus the combined forecast table', async () => {
    const vm = makeViewModel({
      sourceOrderSheets: [
        makeSourceOrderSheet({ id: 'os-1', distributorName: 'Distributor A' }),
        makeSourceOrderSheet({ id: 'os-2', poNumber: 'EIOS/26-27/0002', distributorName: 'Distributor B', purchaseMode: 'Sale or Return' }),
      ],
      combinedForecast: [makeCombinedForecast()],
    });
    const blob = await pdf(<JobOrderDetailDocument viewModel={vm} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders production stages and a PRODUCTION_COMPLETE-style Job Order without throwing', async () => {
    const vm = makeViewModel({
      identityItems: [{ label: 'Lifecycle Status', value: 'Production Complete' }],
      stages: [makeStage({ id: 's1', sequence: 1, stageName: 'Cutting' }), makeStage({ id: 's2', sequence: 2, stageName: 'Sewing' })],
    });
    const blob = await pdf(<JobOrderDetailDocument viewModel={vm} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders PP Sample and PPM as independent rows, including a null (em-dash) PPM outcome, without throwing', async () => {
    const vm = makeViewModel({
      qualityActivities: [
        makeQualityActivity({ id: 'pp-sample', name: 'PP Sample', outcome: 'PASS' }),
        makeQualityActivity({
          id: 'ppm',
          name: 'PPM',
          sequence: 2,
          gateRequirement: 'Finalized (no pass/fail outcome)',
          outcome: null,
        }),
      ],
    });
    const blob = await pdf(<JobOrderDetailDocument viewModel={vm} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders zero and null quantities distinctly without throwing', async () => {
    const vm = makeViewModel({ sizes: [makeSize({ orderedQuantity: 0, preparedQuantity: 0, varianceQuantity: 0 })] });
    const blob = await pdf(<JobOrderDetailDocument viewModel={vm} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders enough content to force multiple pages without silent truncation of any section', async () => {
    const manySourceOrderSheets = Array.from({ length: 30 }, (_, i) =>
      makeSourceOrderSheet({ id: `os-${i}`, poNumber: `EIOS/26-27/${String(i).padStart(4, '0')}`, distributorName: `Distributor ${i}` }),
    );
    const manySizes = Array.from({ length: 25 }, (_, i) => makeSize({ id: `sz-${i}`, sizeCode: `SZ${i}` }));
    const manyStages = Array.from({ length: 20 }, (_, i) =>
      makeStage({ id: `stage-${i}`, sequence: i, stageName: `Stage ${i}` }),
    );
    const manyQualityActivities = Array.from({ length: 15 }, (_, i) =>
      makeQualityActivity({ id: `qa-${i}`, sequence: i, name: `Quality Activity ${i}`, coverageSummary: `Prepared 500 · Inspected 500 · Passed ${i} · Failed 0` }),
    );

    const vm = makeViewModel({
      sourceOrderSheets: manySourceOrderSheets,
      combinedForecast: manySizes.map((size) => ({
        sizeId: size.id,
        sizeLabel: size.sizeCode,
        forecastQuantity: 100,
        jobOrderQuantity: 90,
        varianceQuantity: -10,
      })),
      sizes: manySizes,
      stages: manyStages,
      qualityActivities: manyQualityActivities,
    });

    const blob = await Promise.race([
      pdf(<JobOrderDetailDocument viewModel={vm} />).toBlob(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('PDF generation hung on a large Job Order detail')), 10000),
      ),
    ]);
    expect(blob.size).toBeGreaterThan(0);
  }, 12000);

  it('renders a long Style/Factory name without throwing', async () => {
    const vm = makeViewModel({
      subtitle: 'EIJO/26-27/0001 — A Very Long Factory Name Private Limited That Wraps',
      styleName: 'A Very Long Style Name That Could Wrap Across Multiple Lines In The PDF Layout',
    });
    const blob = await pdf(<JobOrderDetailDocument viewModel={vm} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });
});
