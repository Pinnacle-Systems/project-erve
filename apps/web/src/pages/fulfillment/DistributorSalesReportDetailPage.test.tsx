/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { DistributorSalesReportDetailPage } from './DistributorSalesReportDetailPage.js';
import type { DistributorSalesReportLineView, DistributorSalesReportView } from './types.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const content = () => container.textContent ?? '';

function buildReport(overrides: Partial<DistributorSalesReportView> = {}): DistributorSalesReportView {
  return {
    id: 'dsr-1',
    distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' },
    reportDate: '2026-09-01T00:00:00.000Z',
    remarks: null,
    submittedBy: { id: 'user-1', name: 'Test User', email: 'user@test.local' },
    submittedAt: '2026-09-01T00:00:00.000Z',
    lines: [],
    ...overrides,
  };
}

async function renderPage(getImpl: (url: string) => Promise<unknown>) {
  vi.spyOn(apiClient, 'get').mockImplementation(getImpl as never);

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/fulfillment/distributor-sales-reports/dsr-1']}>
          <Routes>
            <Route path="/fulfillment/distributor-sales-reports/:id" element={<DistributorSalesReportDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(() => expect(content()).not.toContain('Loading sales report'));
}

describe('DistributorSalesReportDetailPage load error handling (UXAUTH-018)', () => {
  it('shows an error state, not a not-found/empty state, when the request fails', async () => {
    await renderPage(async () => {
      throw new Error('Request failed with status code 403');
    });

    expect(content()).not.toContain('Sales report not found');
    expect(content()).toContain('Unable to load sales report');
    expect(content()).toContain('Request failed with status code 403');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('still renders the record normally when the request succeeds', async () => {
    const report = buildReport();
    await renderPage(async (url: string) => {
      if (url === '/distributor-sales-reports/dsr-1') return { data: { data: report } };
      throw new Error(`Unexpected GET: ${url}`);
    });

    expect(content()).toContain('Distributor One');
    expect(content()).not.toContain('Unable to load sales report');
  });
});

function salesLine(overrides: Partial<DistributorSalesReportLineView> = {}): DistributorSalesReportLineView {
  return {
    id: 'line-1',
    erveDispatch: { id: 'ed-1', erveDispatchNumber: 'EIED/26-27/0001' },
    saleOrderLineId: 'sol-1',
    saleOrderId: 'so-1',
    saleOrderNumber: 'EISO/26-27/0001',
    styleId: 'style-1',
    styleNumber: 'ST-001',
    styleName: 'Classic Tee',
    primaryImage: null,
    sizeId: 'size-m',
    sizeCode: 'M',
    sizeLabel: 'Medium',
    sizeSortOrder: 2,
    quantitySold: 4,
    ...overrides,
  };
}

describe('DistributorSalesReportDetailPage grouped Style x Size lines (ISS-023 / DEMO-003)', () => {
  const sections = () => Array.from(container.querySelectorAll('section'));
  const headers = (section: Element) => Array.from(section.querySelectorAll('thead th')).map((th) => th.textContent);
  const bodyRows = (section: Element) =>
    Array.from(section.querySelectorAll('tbody tr')).map((tr) => Array.from(tr.children).map((cell) => (cell.querySelector('input') as HTMLInputElement | null)?.value ?? cell.textContent));

  async function renderLines(lines: DistributorSalesReportLineView[]) {
    await renderPage(async () => ({ data: { data: buildReport({ lines }) } }));
  }

  it('shows one Style row with Sizes as canonical columns instead of one row per Style/Size', async () => {
    await renderLines([
      salesLine({ id: 'l-l', saleOrderLineId: 'sol-l', sizeId: 'size-l', sizeCode: 'L', sizeLabel: 'Large', sizeSortOrder: 3, quantitySold: 5 }),
      salesLine({ id: 'l-s', saleOrderLineId: 'sol-s', sizeId: 'size-s', sizeCode: 'S', sizeLabel: 'Small', sizeSortOrder: 1, quantitySold: 2 }),
    ]);
    expect(sections()).toHaveLength(1);
    expect(headers(sections()[0]!)).toEqual(['Style', 'S', 'L', 'Total']);
    const rows = bodyRows(sections()[0]!);
    expect(rows).toHaveLength(1);
    expect(rows[0]![0]).toContain('ST-001');
    expect(rows[0]!.slice(1)).toEqual(['2', '5', '7']);
    expect(content()).toContain('EIED/26-27/0001');
    expect(content()).toContain('Order EISO/26-27/0001');
  });

  it('keeps the same Style under different Dispatches and source orders in separate sections', async () => {
    await renderLines([
      salesLine({ id: 'a', quantitySold: 1 }),
      salesLine({ id: 'b', erveDispatch: { id: 'ed-2', erveDispatchNumber: 'EIED/26-27/0002' }, saleOrderLineId: 'sol-2', quantitySold: 2 }),
      salesLine({ id: 'c', saleOrderId: 'so-2', saleOrderNumber: 'EISO/26-27/0002', saleOrderLineId: 'sol-3', quantitySold: 3 }),
    ]);
    expect(sections()).toHaveLength(3);
    expect(sections().map((section) => section.querySelector('h3')?.textContent)).toEqual([
      'EIED/26-27/0001 · Order EISO/26-27/0001',
      'EIED/26-27/0002 · Order EISO/26-27/0001',
      'EIED/26-27/0001 · Order EISO/26-27/0002',
    ]);
    expect(sections().map((section) => bodyRows(section)[0]!.at(-1))).toEqual(['1', '2', '3']);
  });

  it('aggregates only the displayed quantity of two source lines for one Style/Size and keeps both listed', async () => {
    await renderLines([
      salesLine({ id: 'dup-1', saleOrderLineId: 'sol-a', quantitySold: 4 }),
      salesLine({ id: 'dup-2', saleOrderLineId: 'sol-b', quantitySold: 6 }),
    ]);
    expect(bodyRows(sections()[0]!)[0]!.slice(1)).toEqual(['10', '10']);
    expect(sections()[0]!.textContent).toContain('ST-001 / Medium: 4');
    expect(sections()[0]!.textContent).toContain('(line dup-1)');
    expect(sections()[0]!.textContent).toContain('ST-001 / Medium: 6');
    expect(sections()[0]!.textContent).toContain('(line dup-2)');
  });

  it('shows the placeholder and requests no image when the Style has no primary image, and an empty state for no lines', async () => {
    await renderLines([salesLine()]);
    expect(sections()[0]!.querySelector('svg')).not.toBeNull();
    expect(sections()[0]!.querySelector('img')).toBeNull();
  });

  it('shows an empty state when the report has no lines', async () => {
    await renderLines([]);
    expect(content()).toContain('No lines');
    expect(sections()).toHaveLength(0);
  });
});
