// ISS-075: Factory / QA readers receive no Distributor identity from the API, so every document built
// from their payloads must render without one — and still carry the destination, Store reference,
// address and quantities needed to pack and dispatch. These render the real PDFs and read their text.
import { pdf } from '@react-pdf/renderer';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import type { PackingAuditQueueItem, PackingListView } from '../types.js';
import type { SaleOrder } from '../../sale-orders/types.js';
import { buildDispatchOrderDetailViewModel } from './dispatch-order/buildDispatchOrderDetailViewModel.js';
import { DispatchOrderDetailDocument } from './dispatch-order/DispatchOrderDetailDocument.js';
import { buildDispatchOrderListViewModel } from './dispatch-order/buildDispatchOrderListViewModel.js';
import { DispatchOrderListDocument } from './dispatch-order/DispatchOrderListDocument.js';
import { buildFactoryPackingListViewModel } from './factory-packing-list/buildFactoryPackingListViewModel.js';
import { FactoryPackingListDetailDocument } from './factory-packing-list/FactoryPackingListDetailDocument.js';
import { buildFactoryPackingQueueListViewModel } from './factory-packing-queue/buildFactoryPackingQueueListViewModel.js';
import { FactoryPackingQueueListDocument } from './factory-packing-queue/FactoryPackingQueueListDocument.js';
import { buildPackingAuditListViewModel } from './packing-audit/buildPackingAuditListViewModel.js';
import { PackingAuditListDocument } from './packing-audit/PackingAuditListDocument.js';
import { buildPackingAuditCartonDetailViewModel } from './packing-audit/buildPackingAuditCartonDetailViewModel.js';
import { PackingAuditCartonDetailDocument } from './packing-audit/PackingAuditCartonDetailDocument.js';

const meta = { generatedAt: '2026-11-11T10:00:00Z', generatedBy: 'Factory Operator' };
const related = { factoryDispatches: null, erveDispatches: null, auditTrail: null };

const lineBase = {
  styleId: 'style-1',
  styleNumber: 'ST-001',
  styleName: 'Classic Tee',
  primaryImage: null,
  sizeId: 'size-m',
  sizeCode: 'M',
  sizeLabel: 'M',
  sizeSortOrder: 1,
};

const destination = {
  id: 'dest-1',
  retailStoreId: 'store-1',
  storeCode: 'MX-014',
  label: 'Max Mall Store',
  contactName: 'Store Manager',
  contactPhone: '+91 90000 00000',
  addressLine1: '12 Mall Road',
  addressLine2: null,
  city: 'Chennai',
  state: 'Tamil Nadu',
  country: 'India',
  postalCode: '600001',
  canMoveDistributor: false,
};

// Exactly what the API now sends a FACTORY_USER: one neutral group, no Distributors, no GSTIN/e-mail.
const factorySaleOrder = {
  id: 'so-1',
  saleOrderNumber: 'EISO/26-27/0001',
  distributors: [],
  factory: { id: 'f1', code: 'F1', name: 'Own Factory' },
  financialYear: { id: 'fy', code: '2026-27' },
  soDate: '2026-06-30T00:00:00.000Z',
  status: 'ACTIVE',
  destinationCount: 1,
  totalQuantity: 10,
  createdAt: '2026-06-30T00:00:00.000Z',
  isLocked: false,
  version: 1,
  updatedAt: '2026-06-30T00:00:00.000Z',
  creator: { id: 'u1', name: 'Erve Merchandiser' },
  remarks: null,
  lines: [{ id: 'l1', destinationId: 'dest-1', ...lineBase, quantity: 10, remarks: null }],
  distributorGroups: [
    {
      id: 'so-1',
      distributor: null,
      purchaseMode: null,
      destinations: [destination],
      lines: [{ id: 'l1', destinationId: 'dest-1', ...lineBase, quantity: 10, remarks: null }],
    },
  ],
  fulfillment: { stage: 'FACTORY_DISPATCHED', totalQuantity: 10, totalFactoryPackedQuantity: 10 },
} as unknown as SaleOrder;

const factoryPackingList = {
  saleOrderId: 'so-1',
  saleOrderNumber: 'EISO/26-27/0001',
  distributors: [],
  factory: { id: 'f1', code: 'F1', name: 'Own Factory' },
  factoryDispatch: {
    id: 'fd-1',
    factoryDispatchNumber: 'EIFD/26-27/0001',
    status: 'DRAFT',
    version: 1,
    factoryInvoiceId: null,
  },
  destinations: [
    {
      ...destination,
      lines: [{ saleOrderLineId: 'l1', ...lineBase, requiredQuantity: 10, packedQuantity: 4 }],
      cartons: [],
    },
  ],
  retiredCartons: [],
} as unknown as PackingListView;

const auditItem = {
  id: 'carton-1',
  cartonNumber: 'C1',
  destinationId: 'dest-1',
  packageDetails: null,
  netWeight: null,
  grossWeight: null,
  dimensions: null,
  version: 1,
  totalQuantity: 4,
  destinationMismatch: false,
  auditState: 'NOT_INSPECTED',
  retired: false,
  retiredAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  lines: [{ saleOrderLineId: 'l1', ...lineBase, quantity: 4, currentDestinationId: 'dest-1' }],
  auditHistory: [],
  factoryDispatchNumber: 'EIFD/26-27/0001',
  factory: { id: 'f1', code: 'F1', name: 'Own Factory' },
  saleOrder: { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001' },
  destination: { id: 'dest-1', label: 'Max Mall Store', city: 'Chennai', state: 'Tamil Nadu' },
} as unknown as PackingAuditQueueItem;

async function textOf(element: Parameters<typeof pdf>[0]): Promise<string> {
  const bytes = new Uint8Array(await (await pdf(element).toBlob()).arrayBuffer());
  const doc = await getDocument({ data: bytes.slice(), useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    pages.push(
      (await page.getTextContent()).items.flatMap((i) => ('str' in i ? [i.str] : [])).join(' '),
    );
  }
  return pages.join('\n');
}

// "Distributors" (plural header), Purchase Mode wording and GSTIN rows must be absent.
const NO_DISTRIBUTOR_UI = /\bDistributors\b|Distributor Count|Purchase Mode|Outright|Sale\/Return|GSTIN/;

describe('Factory / QA documents render without any Distributor identity', () => {
  it('Dispatch Order detail PDF: neutral destinations section, address and quantities kept', async () => {
    const text = await textOf(
      <DispatchOrderDetailDocument
        viewModel={buildDispatchOrderDetailViewModel(factorySaleOrder, related, meta)}
      />,
    );
    expect(text).not.toMatch(NO_DISTRIBUTOR_UI);
    expect(text).toContain('Destinations');
    expect(text).toContain('All destinations (Total: 10)');
    expect(text).toContain('Max Mall Store');
    expect(text).toContain('12 Mall Road');
    expect(text).toContain('Factory Dispatched');
  });

  it('Dispatch Order list PDF: no Distributors column', async () => {
    const vm = buildDispatchOrderListViewModel([factorySaleOrder], {}, meta);
    expect(vm.showDistributors).toBe(false);
    const text = await textOf(<DispatchOrderListDocument viewModel={vm} />);
    expect(text).not.toMatch(/\bDistributors\b/);
    expect(text).toContain('EISO/26-27/0001');
    expect(text).toContain('Own Factory');
  });

  it('Factory Packing List PDF: destination is titled by Store name and code', async () => {
    const vm = buildFactoryPackingListViewModel(factoryPackingList, meta);
    expect(vm.destinations[0]).toMatchObject({
      label: 'Max Mall Store (MX-014)',
      distributorName: null,
    });
    const text = await textOf(<FactoryPackingListDetailDocument viewModel={vm} />);
    expect(text).not.toMatch(NO_DISTRIBUTOR_UI);
    expect(text).toContain('Max Mall Store (MX-014)');
    expect(text).toContain('12 Mall Road');
  });

  it('Factory Packing Queue PDF: Destination column instead of Distributor, no Distributors column', async () => {
    const vm = buildFactoryPackingQueueListViewModel(
      [
        {
          saleOrderId: 'so-1',
          saleOrderNumber: 'EISO/26-27/0001',
          destination: {
            id: 'dest-1',
            label: 'Max Mall Store',
            storeCode: 'MX-014',
            city: 'Chennai',
            state: 'Tamil Nadu',
          },
          saleOrderLineId: 'l1',
          ...lineBase,
          allocatedQuantity: 10,
          packedQuantity: 4,
          remainingQuantity: 6,
        },
      ],
      [
        {
          id: 'fd-1',
          factoryDispatchNumber: 'EIFD/26-27/0001',
          factory: { id: 'f1', code: 'F1', name: 'Own Factory' },
          saleOrder: { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001', distributors: [] },
          status: 'DRAFT',
          version: 1,
          preparedAt: '2026-09-01T00:00:00.000Z',
          finalizedAt: null,
          consolidated: false,
        },
      ],
      meta,
    );
    expect(vm.showDistributors).toBe(false);
    const text = await textOf(<FactoryPackingQueueListDocument viewModel={vm} />);
    expect(text).not.toMatch(/\bDistributors?\b/);
    expect(text).toContain('Destination');
    expect(text).toContain('Max Mall Store');
    expect(text).toContain('MX-014');
  });

  it('Packing Audit queue and carton PDFs: no Distributor column or row, destination and quantity kept', async () => {
    const listVm = buildPackingAuditListViewModel([auditItem], meta);
    expect(listVm.showDistributors).toBe(false);
    const list = await textOf(<PackingAuditListDocument viewModel={listVm} />);
    expect(list).not.toMatch(/\bDistributors?\b/);
    expect(list).toContain('Max Mall Store');
    const detail = await textOf(
      <PackingAuditCartonDetailDocument
        viewModel={buildPackingAuditCartonDetailViewModel(
          { ...auditItem, factoryDispatchId: 'fd-1' },
          meta,
        )}
      />,
    );
    expect(detail).not.toMatch(/\bDistributors?\b/);
    expect(detail).toContain('Max Mall Store');
    expect(detail).toContain('Carton C1');
  });
});
