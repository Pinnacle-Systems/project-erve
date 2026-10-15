import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../../../lib/api-client.js';
import { prepareDispatchOrderDetailPdfData } from './prepareDispatchOrderDetailPdfData.js';
import type {
  DispatchOrderDetailLineRow,
  DispatchOrderDetailPdfViewModel,
} from './buildDispatchOrderDetailViewModel.js';

vi.mock('../../../../lib/pdf/resizeImage.js', () => ({
  resizeImageBlobToDataUri: vi.fn(
    async (blob: Blob) => `data:image/jpeg;base64,${await blob.text()}`,
  ),
}));
afterEach(() => vi.restoreAllMocks());

function model(): DispatchOrderDetailPdfViewModel {
  const lines: DispatchOrderDetailLineRow[] = [
    {
      id: 'a',
      styleDisplay: 'Style A',
      sizeLabel: 'M',
      quantity: 5,
      primaryImage: { id: 'file-a', path: '/styles/a/images/primary-a/content' },
    },
    {
      id: 'a-large',
      styleDisplay: 'Style A',
      sizeLabel: 'L',
      quantity: 7,
      primaryImage: { id: 'file-a', path: '/styles/a/images/primary-a/content' },
    },
    {
      id: 'b',
      styleDisplay: 'Style B',
      sizeLabel: 'M',
      quantity: 9,
      primaryImage: { id: 'file-b', path: '/styles/b/images/primary-b/content' },
    },
    { id: 'none', styleDisplay: 'No image', sizeLabel: 'M', quantity: 1, primaryImage: null },
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
          lines,
        })),
      },
    ],
    styleSizeTotals: lines.map((line) => ({ ...line, key: line.id, quantity: line.quantity * 2 })),
  };
}

describe('prepareDispatchOrderDetailPdfData', () => {
  it('fetches each primary file once across sizes, destinations and totals and preserves source data', async () => {
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
        for (const line of dest.lines) line.primaryImage = null;
    for (const row of vm.styleSizeTotals) row.primaryImage = null;
    expect((await prepareDispatchOrderDetailPdfData(vm)).size).toBe(0);
    expect(get).not.toHaveBeenCalled();
  });
});
