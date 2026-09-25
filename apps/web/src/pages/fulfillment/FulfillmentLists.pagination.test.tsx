/** @vitest-environment jsdom */
import { describe, it } from 'vitest';
import { expectLoadsEveryPage } from '../../test-support/cursor-list-page.js';
import { ErveDispatchListPage } from './ErveDispatchListPage.js';
import { ErvePackingListListPage } from './ErvePackingListListPage.js';
import { DistributorSalesReportListPage } from './DistributorSalesReportListPage.js';
import { DistributorReturnListPage } from './DistributorReturnListPage.js';
import { FactoryInvoiceListPage } from './FactoryInvoiceListPage.js';
import { InvoiceHandoffListPage } from './InvoiceHandoffListPage.js';

// These endpoints are cursor-paginated. Each list previously made a single
// request (limit 50 or 100) and never followed pageInfo.nextCursor, so rows
// past that first batch were unreachable.

const num = (prefix: string, n: number) => `${prefix}/26-27/${String(n).padStart(4, '0')}`;
const distributor = (n: number) => ({ id: `d${n}`, code: `D${n}`, name: `Distributor ${n}` });
const user = { id: 'u1', name: 'Submitter' };

describe('fulfilment and finance list pagination', () => {
  it('ERVE Dispatches reach every page', async () => {
    await expectLoadsEveryPage({
      element: <ErveDispatchListPage />,
      path: '/erve-dispatches',
      noun: 'dispatches',
      rowText: (n) => num('EIED', n),
      row: (n) => ({
        id: `ed-${n}`,
        erveDispatchNumber: num('EIED', n),
        saleOrder: null,
        distributor: distributor(n),
        dispatchDate: '2026-09-01T00:00:00.000Z',
        transporter: null,
        lrNumber: null,
        totalQuantity: 5,
      }),
    });
  });

  it('ERVE Packing Lists reach every page', async () => {
    await expectLoadsEveryPage({
      element: <ErvePackingListListPage />,
      path: '/erve-packing-lists',
      noun: 'packing lists',
      rowText: (n) => num('EIPL', n),
      row: (n) => ({
        id: `pl-${n}`,
        ervePackingListNumber: num('EIPL', n),
        distributor: distributor(n),
        destination: { city: 'Kochi', state: 'Kerala' },
        cartonCount: 1,
        totalQuantity: 5,
        sourceFactories: [],
        status: 'OPEN',
      }),
    });
  });

  it('Distributor Sales Reports reach every page', async () => {
    await expectLoadsEveryPage({
      element: <DistributorSalesReportListPage />,
      path: '/distributor-sales-reports',
      noun: 'sales reports',
      rowText: (n) => `Distributor ${n}Submitter`,
      row: (n) => ({
        id: `sr-${n}`,
        reportDate: '2026-09-01T00:00:00.000Z',
        distributor: distributor(n),
        submittedBy: user,
        lines: [{ quantitySold: 2 }],
      }),
    });
  });

  it('Distributor Returns reach every page', async () => {
    await expectLoadsEveryPage({
      element: <DistributorReturnListPage />,
      path: '/distributor-returns',
      noun: 'returns',
      rowText: (n) => num('EIDR', n),
      row: (n) => ({
        id: `dr-${n}`,
        returnNumber: num('EIDR', n),
        returnDate: '2026-09-01T00:00:00.000Z',
        distributor: distributor(n),
        submittedBy: user,
        lines: [{ requestedQuantity: 1 }],
        status: 'SUBMITTED',
      }),
    });
  });

  it('Factory Invoices reach every page', async () => {
    await expectLoadsEveryPage({
      element: <FactoryInvoiceListPage />,
      path: '/factory-invoices',
      noun: 'factory invoices',
      rowText: (n) => num('EIFD', n),
      row: (n) => ({
        id: `fi-${n}`,
        factory: { id: 'f1', name: 'Clifton' },
        factoryDispatch: { id: `fd-${n}`, factoryDispatchNumber: num('EIFD', n) },
        lines: [],
        subtotal: 100,
        total: 105,
        status: 'GENERATED',
      }),
    });
  });

  it('Invoice Handoffs reach every page', async () => {
    await expectLoadsEveryPage({
      element: <InvoiceHandoffListPage />,
      path: '/invoice-handoffs',
      noun: 'invoice handoffs',
      rowText: (n) => num('EIED', n),
      row: (n) => ({
        id: `ih-${n}`,
        purchaseMode: 'OUTRIGHT',
        erveDispatch: { id: `ed-${n}`, erveDispatchNumber: num('EIED', n) },
        distributor: distributor(n),
        style: { styleNumber: 'ST-1' },
        size: { sizeLabel: 'M' },
        quantity: 1,
        status: 'PENDING_TALLY',
        tallyInvoiceNumber: null,
      }),
    });
  });
});
