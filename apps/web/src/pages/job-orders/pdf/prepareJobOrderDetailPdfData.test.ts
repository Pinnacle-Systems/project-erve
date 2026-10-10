import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobOrder } from '../types.js';
import { prepareJobOrderDetailPdfData } from './prepareJobOrderDetailPdfData.js';

const resolveImagesForPdfMock = vi.fn();
vi.mock('../../../lib/pdf/images.js', () => ({
  resolveImagesForPdf: (...args: unknown[]) => resolveImagesForPdfMock(...args),
}));

afterEach(() => {
  resolveImagesForPdfMock.mockReset();
});

function makeLine(overrides: Partial<JobOrder['lines'][number]> = {}): JobOrder['lines'][number] {
  return {
    id: 'line-1',
    styleId: 'style-1',
    styleNumber: 'STY-0001',
    styleName: 'Basic Tee',
    primaryImage: null,
    orderedQuantityTotal: 500,
    preparedQuantityTotal: 200,
    status: 'IN_PRODUCTION',
    sizes: [],
    ...overrides,
  };
}

function makeJobOrder(overrides: Partial<JobOrder> = {}): JobOrder {
  return {
    id: 'jo-1',
    jobOrderNumber: 'EIJO/26-27/0001',
    financialYear: { id: 'fy1', code: '2026-27' },
    factory: { id: 'f1', code: 'F1', name: 'Acme Factory' },
    unitPrice: 125.5,
    status: 'IN_PRODUCTION',
    operationalState: {
      lifecycleContext: { code: 'IN_PRODUCTION', label: 'In Production', tone: 'info', activityId: null, activityName: null },
      productionState: null,
      qualityState: null,
      primaryDisplayState: { code: 'IN_PRODUCTION', label: 'In Production', tone: 'info', activityId: null, activityName: null },
    },
    factoryConfirmationStatus: 'CONFIRMED',
    requiredDeliveryDate: null,
    deliveryDateLocked: false,
    isDelayed: false,
    orderedQuantityTotal: 500,
    preparedQuantityTotal: 200,
    sourceOrderSheetCount: 1,
    createdAt: '2026-04-01T00:00:00.000Z',
    version: 1,
    updatedAt: '2026-04-01T00:00:00.000Z',
    seasonSnapshots: [],
    processFlowVersion: { id: 'pfv1', versionNumber: 2, status: 'ACTIVE', processFlow: { id: 'pf1', code: 'PF1', name: 'Standard Flow' } },
    confirmedBy: null,
    confirmedAt: null,
    disclaimerText: null,
    disclaimerRevision: 0,
    acknowledgement: null,
    acknowledgements: [],
    productionStartedAt: null,
    productionCompletedAt: null,
    creator: { id: 'u1', name: 'Test User', email: 'test@erve.local' },
    lines: [makeLine()],
    stages: [],
    qualityActivities: [],
    reworkTasks: [],
    ...overrides,
  };
}

describe('prepareJobOrderDetailPdfData', () => {
  it('resolves the primary image when every line shares one Style and it has an image', async () => {
    const jobOrder = makeJobOrder({
      lines: [
        makeLine({
          primaryImage: {
            id: 'img-1',
            styleId: 'style-1',
            fileId: 'file-1',
            fileName: 'x',
            mimeType: 'image/jpeg',
            sizeBytes: 1,
            isPrimary: true,
            sortOrder: 0,
            createdAt: '',
            updatedAt: '',
          },
        }),
      ],
    });
    resolveImagesForPdfMock.mockResolvedValue(new Map([['file-1', { dataUri: 'data:image/jpeg;base64,mock' }]]));

    const result = await prepareJobOrderDetailPdfData(jobOrder);

    expect(resolveImagesForPdfMock).toHaveBeenCalledWith(
      [{ id: 'file-1', path: '/styles/style-1/images/img-1/content' }],
      { maxDimension: 480 },
    );
    expect(result.primaryImage).toEqual({ dataUri: 'data:image/jpeg;base64,mock' });
  });

  it('returns a placeholder and skips the network call when the Style has no image', async () => {
    const result = await prepareJobOrderDetailPdfData(makeJobOrder());
    expect(resolveImagesForPdfMock).not.toHaveBeenCalled();
    expect(result.primaryImage).toEqual({ placeholder: true });
  });

  it('returns a placeholder — never guesses an image — when lines disagree on Style', async () => {
    const jobOrder = makeJobOrder({
      lines: [
        makeLine({
          styleId: 'style-1',
          primaryImage: {
            id: 'img-1',
            styleId: 'style-1',
            fileId: 'file-1',
            fileName: 'x',
            mimeType: 'image/jpeg',
            sizeBytes: 1,
            isPrimary: true,
            sortOrder: 0,
            createdAt: '',
            updatedAt: '',
          },
        }),
        makeLine({ id: 'line-2', styleId: 'style-2', styleNumber: 'STY-0002' }),
      ],
    });

    const result = await prepareJobOrderDetailPdfData(jobOrder);

    expect(resolveImagesForPdfMock).not.toHaveBeenCalled();
    expect(result.primaryImage).toEqual({ placeholder: true });
  });

  it('returns a placeholder for a Job Order with no lines at all', async () => {
    const result = await prepareJobOrderDetailPdfData(makeJobOrder({ lines: [] }));
    expect(resolveImagesForPdfMock).not.toHaveBeenCalled();
    expect(result.primaryImage).toEqual({ placeholder: true });
  });
});
