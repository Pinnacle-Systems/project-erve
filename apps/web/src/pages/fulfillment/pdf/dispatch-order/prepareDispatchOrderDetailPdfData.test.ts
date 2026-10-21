import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../../../lib/api-client.js';
import { prepareDispatchOrderDetailPdfData } from './prepareDispatchOrderDetailPdfData.js';
import type {
  DispatchOrderDetailPdfViewModel,
  DispatchOrderDetailStyleRow,
} from './buildDispatchOrderDetailViewModel.js';

vi.mock('../../../../lib/pdf/resizeImage.js', () => ({
  resizeImageBlobToDataUri: vi.fn(
    async (blob: Blob) => `data:image/jpeg;base64,${await blob.text()}`,
  ),
}));
afterEach(() => vi.restoreAllMocks());

function model(): DispatchOrderDetailPdfViewModel {
  const styleRows: DispatchOrderDetailStyleRow[] = [
    {
      styleId: 'a',
      styleNumber: 'Style A',
      styleName: '',
      values: { M: 5, L: 7 },
      primaryImage: { id: 'file-a', path: '/styles/a/images/primary-a/content' },
    },
    {
      styleId: 'b',
      styleNumber: 'Style B',
      styleName: '',
      values: { M: 9 },
      primaryImage: { id: 'file-b', path: '/styles/b/images/primary-b/content' },
    },
    { styleId: 'none', styleNumber: 'No image', styleName: '', values: { M: 1 }, primaryImage: null },
  ];
  return {
    title: 'DISPATCH ORDER',
    subtitle: '',
    generatedAt: '',
    identityItems: [],
    grandTotalQuantity: 44,
    factoryDispatches: null,
    erveDispatches: null,
    auditTrail: null,
    distributorGroups: [
      {
        id: 'group',
        distributorName: 'Distributor',
        purchaseModeLabel: 'Outright',
        totalQuantity: 44,
        destinations: ['dest-a', 'dest-b'].map((id) => ({
          id,
          label: id,
          addressLine: '',
          contactLine: null,
          gstin: null,
          totalQuantity: 22,
          sizeColumns: [{ sizeId: 'M', sizeCode: 'M' }, { sizeId: 'L', sizeCode: 'L' }],
          styleRows,
        })),
      },
    ],
    overallSizeColumns: [{ sizeId: 'M', sizeCode: 'M' }, { sizeId: 'L', sizeCode: 'L' }],
    overallStyleRows: styleRows.map((row) => ({
      ...row,
      values: Object.fromEntries(Object.entries(row.values).map(([k, v]) => [k, (v ?? 0) * 2])),
    })),
  };
}

describe('prepareDispatchOrderDetailPdfData', () => {
  it('fetches each primary file once across destinations and the overall totals and preserves source data', async () => {
    const paths: string[] = [];
    vi.spyOn(apiClient, 'get').mockImplementation(async (path: string) => {
      paths.push(path);
      return { data: new Blob([path.includes('/a/') ? 'a' : 'b']) };
    });
    const vm = model();
    const before = structuredClone(vm);
    const images = await prepareDispatchOrderDetailPdfData(vm);
    expect(paths.sort()).toEqual([
      '/styles/a/images/primary-a/content',
      '/styles/b/images/primary-b/content',
    ]);
    expect(images.size).toBe(2);
    expect(images.get('file-a')).toEqual({ dataUri: 'data:image/jpeg;base64,a' });
    expect(images.get('file-b')).toEqual({ dataUri: 'data:image/jpeg;base64,b' });
    expect(vm).toEqual(before);
  });

  it('caches inaccessible primary images as placeholders while resolving the others', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(async (path: string) => {
      if (path.includes('/a/')) throw new Error('403');
      return { data: new Blob(['b']) };
    });
    const images = await prepareDispatchOrderDetailPdfData(model());
    expect(images.get('file-a')).toEqual({ placeholder: true });
    expect(images.get('file-b')).toEqual({ dataUri: 'data:image/jpeg;base64,b' });
  });

  it('does not fetch anything for an order with no primary images', async () => {
    const get = vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('unexpected fetch'));
    const vm = model();
    for (const group of vm.distributorGroups)
      for (const dest of group.destinations)
        for (const row of dest.styleRows) row.primaryImage = null;
    for (const row of vm.overallStyleRows) row.primaryImage = null;
    expect((await prepareDispatchOrderDetailPdfData(vm)).size).toBe(0);
    expect(get).not.toHaveBeenCalled();
  });
});
