/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, ReconciliationDetail, Role } from '@erve/types';
import * as AuthContext from '../../auth/AuthContext.js';
import { apiClient } from '../../lib/api-client.js';
import { DispatchReconciliationTab } from './dispatch-workspace/DispatchReconciliationTab.js';
import { PostDispatchReconciliationPage } from './PostDispatchReconciliationPage.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
let data: ReconciliationDetail;
const line = {
  saleOrderLineId: 'a',
  saleOrderNumber: 'SO-1',
  purchaseMode: 'SALE_RETURN',
  styleId: 'st',
  styleNumber: 'ST-1',
  styleName: 'Tee',
  sizeId: 's',
  sizeLabel: 'Small',
  sizeSortOrder: 1,
  dispatchedQuantity: 60,
  receivedQuantity: 50,
  ledgerQuantity: 40,
  difference: 10,
  differs: true,
  shortageQuantity: 10,
  actualSoldQuantity: 5,
  returnedQuantity: 0,
  approvedAwaitingReceiptQuantity: 0,
  pendingRequestedQuantity: 2,
  availableForActualSale: 35,
  availableForNewReturn: 33,
};
beforeEach(() => {
  data = {
    summary: {
      id: 'ed',
      dispatchNumber: 'ED-1',
      distributorId: 'dist',
      distributorName: 'Distributor',
      dispatchDate: '2026-11-01',
      dispatchedQuantity: 100,
      cartonCount: 2,
      qrConfirmed: 1,
      qrPending: 1,
      receiptId: 'receipt',
      receivedQuantity: 70,
      shortageQuantity: 30,
      ledgerQuantity: 70,
      ledgerSource: 'LEGACY_ASSUMED_FULL_RECEIPT',
      ledgerDisposition: 'EVIDENCE_ONLY_EXISTING',
      awaitingReceipt: false,
      receiptMatchesLedger: false,
      receiptDiffers: true,
      nothingReceived: false,
      hasShortage: true,
      downstreamActivity: true,
      followUpRequired: true,
      snapshotToken: 'a'.repeat(32),
      latestReviewId: null,
      latestReviewAction: null,
      pendingReview: true,
    },
    lines: [
      line,
      {
        ...line,
        saleOrderLineId: 'b',
        saleOrderNumber: 'SO-2',
        purchaseMode: 'OUTRIGHT',
        dispatchedQuantity: 40,
        receivedQuantity: 20,
        ledgerQuantity: 30,
        difference: -10,
        shortageQuantity: 20,
      },
    ],
    cartons: [{ id: 'c', cartonNumber: 'C1', confirmedAt: null }],
    receipt: {
      receivedAt: '2026-11-02',
      receivedBy: 'Distributor',
      remarks: 'Short receipt',
      priorSource: 'LEGACY_ASSUMED_FULL_RECEIPT',
      priorRemarks: null,
    },
    ledger: { recordedBy: null, recordedAt: null, remarks: null },
    reviews: [],
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url) => ({
    data: {
      data:
        url === '/post-dispatch-reconciliation'
          ? { items: [data.summary], total: 26, page: 1, pageSize: 25 }
          : data,
    },
  }));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function render(role: Role, queue = false) {
  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    user: { roles: [role], name: 'User' } as AuthUser,
  } as ReturnType<typeof AuthContext.useAuth>);
  await act(async () =>
    root.render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        <MemoryRouter>
          {queue ? (
            <PostDispatchReconciliationPage />
          ) : (
            <DispatchReconciliationTab dispatchId="ed" />
          )}
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => expect(container.textContent).not.toContain('Loading'));
}
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label)!;
function enterRemarks(value: string) {
  act(() => {
    const el = container.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('A5 reconciliation UI', () => {
  it('does not label final zero evidence without a ledger as an existing-ledger discrepancy', async () => {
    data.summary = {
      ...data.summary,
      receivedQuantity: 0,
      ledgerQuantity: null,
      ledgerDisposition: 'NOT_APPLIED_ZERO',
      receiptDiffers: false,
      nothingReceived: true,
    };
    data.lines = [
      {
        ...line,
        receivedQuantity: 0,
        ledgerQuantity: null,
        difference: null,
        shortageQuantity: 60,
      },
    ];
    await render('ADMIN');
    expect(container.textContent).toContain('Nothing received');
    expect(container.textContent).not.toContain('Source-line receipt / ledger discrepancy');
  });
  it('shows source-line discrepancies despite equal group totals, separate evidence, assumptions and exposure', async () => {
    await render('MERCHANDISER');
    expect(container.textContent).toContain('Source-line receipt / ledger discrepancy');
    expect(container.textContent).toContain('SO-1');
    expect(container.textContent).toContain('SO-2');
    expect(container.textContent).toContain('SALE_RETURN');
    expect(container.textContent).toContain('OUTRIGHT');
    expect(container.textContent).toContain('Legacy assumed full receipt (assumption)');
    expect(container.textContent).toContain('Follow-up required');
    expect(container.textContent).toContain('Available for new Return 33');
    expect(container.querySelector('input[type="number"]')).toBeNull();
  });
  it('distinguishes absent receipt from final zero', async () => {
    data.receipt = null;
    data.summary.receivedQuantity = null;
    data.summary.awaitingReceipt = true;
    data.lines = [
      {
        ...line,
        receivedQuantity: null,
        ledgerQuantity: null,
        difference: null,
        shortageQuantity: null,
      },
    ];
    await render('ADMIN');
    expect(container.textContent).toContain('Awaiting distributor receipt');
    expect(container.textContent).toContain('Not recorded');
  });
  it.each(['DISTRIBUTOR', 'FACTORY_USER', 'TRANSPORTER'] as Role[])(
    'never fetches internal evidence for %s',
    async (role) => {
      await render(role);
      expect(apiClient.get).not.toHaveBeenCalled();
      expect(container.querySelector('form')).toBeNull();
    },
  );
  it('limits Accountant to Finance review and senior management to read-only', async () => {
    await render('ACCOUNTANT');
    expect([...container.querySelectorAll('option')].map((o) => o.value)).toEqual([
      'FINANCE_REVIEW',
    ]);
    await render('SENIOR_MANAGEMENT');
    expect(container.querySelector('form')).toBeNull();
  });
  it('requires remarks and submits snapshot plus prior review without quantity fields', async () => {
    const post = vi
      .spyOn(apiClient, 'post')
      .mockResolvedValue({ data: { data: { id: 'review' } } });
    await render('MERCHANDISER');
    expect(button('Record review').disabled).toBe(true);
    enterRemarks('Check source allocations');
    await act(async () => button('Record review').click());
    expect(post).toHaveBeenCalledExactlyOnceWith('/erve-dispatches/ed/reconciliation/reviews', {
      action: 'ACKNOWLEDGE',
      remarks: 'Check source allocations',
      snapshotToken: 'a'.repeat(32),
      previousReviewId: null,
    });
    await vi.waitFor(() =>
      expect(container.textContent).toContain('No quantities or financial records changed'),
    );
  });
  it('retains remarks on conflict and requires refreshed comparison before retrying', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('Conflict'));
    await render('MERCHANDISER');
    enterRemarks('Retain my remarks');
    await act(async () => button('Record review').click());
    await vi.waitFor(() => expect(button('Record review').disabled).toBe(true));
    expect(container.querySelector('textarea')!.value).toBe('Retain my remarks');
    expect(button('Refresh comparison before retrying')).toBeTruthy();
  });
  it('uses server filters/pagination and links to reconciliation tab', async () => {
    await render('ADMIN', true);
    expect(container.textContent).toContain('26 dispatches');
    expect(container.querySelector('a')!.getAttribute('href')).toBe(
      '/fulfillment/erve-dispatches/ed?tab=reconciliation',
    );
    await act(async () => button('Next').click());
    await vi.waitFor(() =>
      expect(apiClient.get).toHaveBeenLastCalledWith('/post-dispatch-reconciliation', {
        params: { page: 2, pageSize: 25 },
      }),
    );
  });
  it('retains remarks when refreshing a conflicting review fails', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('Conflict'));
    await render('MERCHANDISER');
    enterRemarks('Keep these investigation notes');
    await act(async () => button('Record review').click());
    await vi.waitFor(() => expect(button('Refresh comparison before retrying')).toBeTruthy());
    vi.mocked(apiClient.get).mockRejectedValue(new Error('Connection unavailable'));
    await act(async () => button('Refresh comparison before retrying').click());
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Unable to load reconciliation'),
    );
    await vi.waitFor(() =>
      expect(container.querySelector('textarea')?.value).toBe('Keep these investigation notes'),
    );
    expect(button('Refresh comparison before retrying')).toBeTruthy();
    expect(button('Record review').disabled).toBe(true);
  });
  it('shows audit actor, timestamp, reason and observed snapshot', async () => {
    data.reviews = [
      {
        id: 'r',
        action: 'FINANCE_REVIEW',
        remarks: 'Invoice assessment requested',
        actor: { id: 'u', name: 'Finance User' },
        createdAt: '2026-11-06T10:00:00Z',
        snapshotToken: 'a'.repeat(32),
        snapshot: { receivedQuantity: 70 },
      },
    ];
    await render('SENIOR_MANAGEMENT');
    expect(container.textContent).toContain('Finance User');
    expect(container.textContent).toContain('Invoice assessment requested');
    expect(container.textContent).toContain('"receivedQuantity": 70');
  });
});
