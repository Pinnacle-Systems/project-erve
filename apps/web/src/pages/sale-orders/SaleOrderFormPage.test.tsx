/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { SaleOrderFormPage } from './SaleOrderFormPage.js';
import type { SaleOrder } from './types.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function triggerByLabel(labelText: string, occurrence = 0): HTMLButtonElement {
  const labels = Array.from(container.querySelectorAll('label')).filter(
    (el) => el.textContent?.trim().replace(/\s*\*$/, '') === labelText,
  );
  const label = labels[occurrence];
  if (!label) throw new Error(`Label "${labelText}" (occurrence ${occurrence}) not found`);
  const id = label.getAttribute('for');
  const el = id ? (document.getElementById(id) as HTMLButtonElement | null) : null;
  if (!el) throw new Error(`Trigger for label "${labelText}" (occurrence ${occurrence}) not found`);
  return el;
}

async function selectOption(labelText: string, optionText: string, occurrence = 0): Promise<void> {
  await act(async () => triggerByLabel(labelText, occurrence).click());
  const option = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find(
    (item) => item.textContent?.trim().includes(optionText),
  );
  if (!option) throw new Error(`Option "${optionText}" not found for "${labelText}"`);
  await act(async () => option.click());
}

function clickButtonByText(text: string): void {
  const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
  if (!button) throw new Error(`Button "${text}" not found`);
  button.click();
}

async function renderCreateForm() {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
    if (url === '/distributors') {
      return {
        data: {
          data: [
            { id: 'dist-1', code: 'D1', name: 'Distributor One', purchaseMode: 'OUTRIGHT', status: 'ACTIVE' },
          ],
        },
      };
    }
    if (url === '/factories') {
      return { data: { data: [{ id: 'fac-1', code: 'FAC1', name: 'Factory One', status: 'ACTIVE' }] } };
    }
    if (url === '/job-orders/pooled-inventory') {
      return {
        data: {
          data: [
            {
              factoryId: 'fac-1',
              factoryCode: 'FAC1',
              factoryName: 'Factory One',
              styleId: 'style-1',
              styleNumber: 'ST-001',
              styleName: 'Classic Tee',
              sizeId: 'size-1',
              sizeCode: 'M',
              sizeLabel: 'Medium',
              releasedQuantity: 100,
              committedQuantity: 0,
              availableQuantity: 100,
            },
          ],
        },
      };
    }
    throw new Error(`Unexpected GET: ${url} ${JSON.stringify(config?.params)}`);
  });

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/sale-orders/new']}>
          <SaleOrderFormPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await flush();
}

describe('SaleOrderFormPage destination/line repeater', () => {
  // Regression test for a Phase 3 smoke-check finding: TextField/SelectField
  // derive their DOM id purely from the label text (see @erve/primitives),
  // so two destinations (or two Style/Size lines) rendered without an
  // explicit `id` produced IDENTICAL ids (e.g. two "field-address-line-1"
  // nodes). That's invalid HTML and breaks label-click-to-focus / any
  // id-based lookup — clicking a second destination's "Address Line 1"
  // label focused the FIRST destination's input instead. Each destination
  // and line now gets an id keyed off its own stable clientKey/key.
  it('gives every destination and line its own unique field ids, even when duplicated', async () => {
    await renderCreateForm();

    await selectOption('Factory', 'Factory One');
    await flush();

    // Add a second destination and a second Style/Size line on it, so the
    // page renders two of every destination-level field and two of every
    // line-level field at once.
    clickButtonByText('+ Add destination');
    await flush();
    clickButtonByText('+ Add Style/Size line'); // Destination 1's line (first match).
    await flush();

    const allIds = Array.from(container.querySelectorAll('[id]')).map((el) => el.id);
    const duplicates = allIds.filter((id, index) => allIds.indexOf(id) !== index);
    expect(duplicates).toEqual([]);

    // Behavioral check tied to the original symptom: typing into the SECOND
    // destination's Address Line 1 (resolved the same way a <label for>
    // click would resolve it) must land in the second destination, not the
    // first.
    const addressInputs = Array.from(container.querySelectorAll('label')).filter(
      (el) => el.textContent?.trim() === 'Address Line 1*',
    );
    expect(addressInputs.length).toBe(2);
    const secondLabelFor = addressInputs[1]!.getAttribute('for')!;
    const firstLabelFor = addressInputs[0]!.getAttribute('for')!;
    expect(secondLabelFor).not.toBe(firstLabelFor);

    const secondInput = document.getElementById(secondLabelFor) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(secondInput, '456 Second Destination Road');
      secondInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const firstInput = document.getElementById(firstLabelFor) as HTMLInputElement;
    expect(firstInput.value).toBe('');
    expect(secondInput.value).toBe('456 Second Destination Road');
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('SaleOrderFormPage edit hydration', () => {
  // Regression test for a Phase 3 smoke-check finding: this is the exact
  // Radix-Select-BubbleSelect hydration race already found and fixed once
  // for this file's Distributor field (see erve-sale-order-edit-hydration-
  // fix), reintroduced by the Phase 3 rewrite - and now also affecting
  // Factory, which the rewrite made mutable on edit too. If the Sale
  // Order's own GET resolves and calls setDistributorId/setFactoryId before
  // the /distributors or /factories option lists have resolved, Radix's
  // hidden native <select> has no matching <option> yet, silently
  // coerces back to "", and Radix's own change handler clobbers the
  // just-hydrated state with onValueChange(""). The fix gates the
  // hydration effect on all three queries being ready.
  it('hydrates Distributor and Factory even when the Sale Order resolves before their option lists', async () => {
    const so: SaleOrder = {
      id: 'so-1',
      saleOrderNumber: 'EISO/26-27/0001',
      distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One', purchaseMode: 'OUTRIGHT' },
      factory: { id: 'fac-1', code: 'FAC1', name: 'Factory One' },
      financialYear: { id: 'fy-1', code: '2026-27' },
      soDate: '2026-09-08T00:00:00.000Z',
      status: 'ACTIVE',
      destinationCount: 1,
      totalQuantity: 25,
      createdAt: '2026-09-08T00:00:00.000Z',
      isLocked: false,
      version: 1,
      updatedAt: '2026-09-08T00:00:00.000Z',
      creator: { id: 'user-1', name: 'Admin', email: 'admin@test.local' },
      remarks: null,
      destinations: [
        {
          id: 'dest-1',
          label: 'Primary Warehouse',
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          addressLine1: '123 Test Industrial Estate',
          addressLine2: null,
          city: 'Mumbai',
          state: 'Maharashtra',
          country: 'India',
          postalCode: null,
        },
      ],
      lines: [
        {
          id: 'line-1',
          destinationId: 'dest-1',
          styleId: 'style-1',
          styleNumber: 'ST-001',
          styleName: 'Classic Tee',
          sizeId: 'size-1',
          sizeCode: 'M',
          sizeLabel: 'Medium',
          quantity: 25,
          remarks: null,
        },
      ],
      fulfillment: { stage: 'AWAITING_PACKING', totalQuantity: 25, totalFactoryPackedQuantity: 0 },
    };

    const distributorsDeferred = deferred<{ data: { data: unknown[] } }>();
    const factoriesDeferred = deferred<{ data: { data: unknown[] } }>();

    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/sale-orders/so-1') return { data: { data: so } };
      if (url === '/distributors') return distributorsDeferred.promise;
      if (url === '/factories') return factoriesDeferred.promise;
      if (url === '/job-orders/pooled-inventory') return { data: { data: [] } };
      throw new Error(`Unexpected GET: ${url}`);
    });

    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={['/sale-orders/so-1/edit']}>
            <Routes>
              <Route path="/sale-orders/:id/edit" element={<SaleOrderFormPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await flush();

    // At this point the Sale Order itself has already resolved, but the
    // Distributor/Factory option lists have not - the exact adverse
    // ordering that triggered the original bug. Neither select has any
    // options yet, so there is nothing to assert hydrated correctly still.
    const distributorTrigger = () => triggerByLabel('Distributor');
    const factoryTrigger = () => triggerByLabel('Factory');
    expect(distributorTrigger().textContent).not.toContain('Distributor One');
    expect(factoryTrigger().textContent).not.toContain('Factory One');

    // Now let the option lists resolve late.
    await act(async () => {
      distributorsDeferred.resolve({
        data: { data: [{ id: 'dist-1', code: 'D1', name: 'Distributor One', purchaseMode: 'OUTRIGHT', status: 'ACTIVE' }] },
      });
      factoriesDeferred.resolve({ data: { data: [{ id: 'fac-1', code: 'FAC1', name: 'Factory One', status: 'ACTIVE' }] } });
    });
    await flush();
    await flush();

    expect(distributorTrigger().textContent).toContain('Distributor One');
    expect(factoryTrigger().textContent).toContain('Factory One');

    // The rest of the hydration (destination address, line quantity) must
    // have landed too, not just the two selects.
    const addressLabel = Array.from(container.querySelectorAll('label')).find(
      (el) => el.textContent?.trim() === 'Address Line 1*',
    )!;
    const addressInput = document.getElementById(addressLabel.getAttribute('for')!) as HTMLInputElement;
    expect(addressInput.value).toBe('123 Test Industrial Estate');
  });

  // Regression test for a second smoke-check finding on the same edit path:
  // a failed Sale Order fetch (network error, expired session, 404) used to
  // fall through to the exact same form the /new route renders, with every
  // field silently blank - indistinguishable from actually creating a new
  // Dispatch Order. SaleOrderDetailPage already guards the identical query
  // with an error EmptyState; the edit form now does too.
  it('shows an error state, not a blank create-like form, when the Sale Order fails to load', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/sale-orders/so-1') throw new Error('Network Error');
      if (url === '/distributors') return { data: { data: [] } };
      if (url === '/factories') return { data: { data: [] } };
      throw new Error(`Unexpected GET: ${url}`);
    });

    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={['/sale-orders/so-1/edit']}>
            <Routes>
              <Route path="/sale-orders/:id/edit" element={<SaleOrderFormPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await flush();
    await flush();

    expect(container.textContent).toContain('Unable to load this dispatch order');
    expect(container.querySelector('input[type="number"]')).toBeNull();
  });
});
