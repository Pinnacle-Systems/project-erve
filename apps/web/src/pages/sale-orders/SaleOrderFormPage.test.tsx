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
vi.mock('../../auth/AuthContext.js', () => ({
  useAuth: () => ({ user: { roles: ['MERCHANDISER'] } }),
}));
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
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
    if (url === '/distributors/options') {
      return {
        data: {
          data: [
            { id: 'dist-1', code: 'D1', name: 'Distributor One', purchaseMode: 'OUTRIGHT', status: 'ACTIVE' },
            { id: 'dist-2', code: 'D2', name: 'Distributor Two', purchaseMode: 'SALE_RETURN', status: 'ACTIVE' },
          ],
        },
      };
    }
    if (url === '/retail-stores/options') {
        const owner = config?.params?.distributorId;
        return {
          data: {
            data: [
              {
                id: `store-${owner}`,
                distributorId: owner,
                code: 'S1',
                name: `Store ${owner}`,
                addressLine1: 'Store Address',
                addressLine2: 'Floor 2',
                city: 'Chennai',
                state: 'TN',
                country: 'India',
                postalCode: '600001',
                contactName: 'Manager',
                contactEmail: 'manager@store.local',
                contactPhone: '9876543210',
                gstin: '22AAAAA0000A1Z5',
                status: 'ACTIVE',
              },
          ],
        },
      };
    }
    if (url === '/factories/options') {
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
    clickButtonByText('+ Add Destination');
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

function textInput(labelText: string, scope: ParentNode = container): HTMLInputElement {
  const label = Array.from(scope.querySelectorAll('label')).find(
    (e) => e.textContent?.trim().replace(/\s*\*$/, '') === labelText,
  )!;
  if (!label) throw new Error(`Missing input ${labelText}`);
  return document.getElementById(label.htmlFor) as HTMLInputElement;
}
async function typeText(label: string, value: string, scope: ParentNode = container) {
  await act(async () => {
    const el = textInput(label, scope);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function chooseDistributor(name: string, occurrence = 0) {
  const lookup = triggerByLabel('Distributor', occurrence) as unknown as HTMLInputElement;
  await act(async () => {
    lookup.focus();
    lookup.click();
  });
  await flush();
  await flush();
  const option = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find(
    (e) => e.textContent?.includes(name),
  )!;
  await act(async () => option.click());
}
async function prepareInline() {
  await renderCreateForm();
  await selectOption('Factory', 'Factory One');
  await flush();
  await chooseDistributor('Distributor One');
  await typeText('Remarks', 'Keep my unsaved notes');
  await act(async () => clickButtonByText('+ Add Style/Size line'));
  await selectOption('Style / Size', 'Classic Tee');
  await typeText('Quantity', '7');
  // Keep a real parent validation error while creating the missing Store.
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  await flush();
  const error = container.querySelector('[role="alert"]')?.textContent ?? container.textContent!;
  await act(async () => clickButtonByText('+ Create new Retail Store'));
  return error;
}
async function fillInline() {
  const dialog = document.body.querySelector('[role="dialog"]')!;
  await typeText('Store Code', 'NEW', dialog);
  await typeText('Store Name', 'New Store', dialog);
  await typeText('Address Line 1', 'New Address', dialog);
  await typeText('City', 'Chennai', dialog);
  await typeText('State', 'TN', dialog);
  await typeText('PIN', '600002', dialog);
  return dialog;
}

describe('DEMO-014 Store selection and inline creation context', () => {
  it('ignores a canceled creation that completes after another creation dialog opens', async () => {
    const pending = deferred<{ data: { data: unknown } }>();
    vi.spyOn(apiClient, 'post').mockRejectedValueOnce(new Error('Destination address is required')).mockImplementationOnce(() => pending.promise);
    await prepareInline();
    const dialog = await fillInline();
    await act(async () => dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => clickButtonByText('+ Create new Retail Store'));
    const reopened = document.body.querySelector('[role="dialog"]')!;
    await typeText('Store Code', 'SECOND', reopened);
    await act(async () => pending.resolve({ data: { data: { id: 'canceled', distributorId: 'dist-1', code: 'FIRST', name: 'Canceled Store', addressLine1: 'Canceled address', city: 'Chennai', state: 'TN', country: 'India', postalCode: '600001', status: 'ACTIVE' } } }));
    await flush();
    expect(document.body.querySelector('[role="dialog"]')).toBe(reopened);
    expect(textInput('Store Code', reopened).value).toBe('SECOND');
    expect(textInput('Retail Store').value).toBe('');
    expect(textInput('Quantity').value).toBe('7');
    expect(textInput('Remarks').value).toBe('Keep my unsaved notes');
  });

  it('scopes Store lookup by Distributor and populates every destination field', async () => {
    await renderCreateForm();
    await selectOption('Factory', 'Factory One');
    await flush();
    await chooseDistributor('Distributor One');
    const lookup = triggerByLabel('Retail Store') as unknown as HTMLInputElement;
    await act(async () => {
      lookup.focus();
      lookup.click();
    });
    await flush();
    await flush();
    const option = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (e) => e.textContent?.includes('Store dist-1'),
    )!;
    await act(async () => option.click());
    expect(apiClient.get).toHaveBeenCalledWith(
      '/retail-stores/options',
      expect.objectContaining({ params: expect.objectContaining({ distributorId: 'dist-1' }) }),
    );
    expect(textInput('Label').value).toBe('Store dist-1');
    expect(textInput('Address Line 1').value).toBe('Store Address');
    expect(textInput('Contact Email').value).toBe('manager@store.local');
    expect(textInput('GSTIN').value).toBe('22AAAAA0000A1Z5');
  });

  it('creates inline, refreshes lookup and selects the new Store without resetting allocations, notes or errors', async () => {
    const post = vi
      .spyOn(apiClient, 'post')
      .mockResolvedValue({
        data: {
          data: {
            id: 'new',
            distributorId: 'dist-1',
            code: 'NEW',
            name: 'New Store',
            addressLine1: 'New Address',
            city: 'Chennai',
            state: 'TN',
            country: 'India',
            postalCode: '600002',
            status: 'ACTIVE',
          },
        },
      }).mockRejectedValueOnce(new Error('Destination address is required'));
    await prepareInline();
    const parent = container.querySelector('form')!;
    expect(container.textContent).toContain('Destination address is required');
    const dialog = await fillInline();
    await act(async () =>
      dialog
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    await flush();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('form')).toBe(parent);
    expect(textInput('Remarks').value).toBe('Keep my unsaved notes');
    expect(textInput('Quantity').value).toBe('7');
    expect(textInput('Retail Store').value).toContain('New Store');
    expect(textInput('Address Line 1').value).toBe('New Address');
    expect(container.textContent).toContain('Destination address is required');
    expect(post.mock.calls).toHaveLength(2);
    expect(post.mock.calls.filter(([url]) => url === '/sale-orders')).toHaveLength(1);
    expect(post).toHaveBeenCalledWith(
      '/retail-stores',
      expect.objectContaining({ distributorId: 'dist-1' }),
    );
  });

  it('keeps parent state after inline failure and cancellation', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('Store Code already exists'));
    await prepareInline();
    const dialog = await fillInline();
    await act(async () =>
      dialog
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    await flush();
    expect(dialog.textContent).toContain('Store Code already exists');
    expect(textInput('Store Code', dialog).value).toBe('NEW');
    expect(textInput('Remarks').value).toBe('Keep my unsaved notes');
    const cancel = Array.from(dialog.querySelectorAll('button')).find(
      (e) => e.textContent === 'Cancel',
    )!;
    await act(async () => cancel.click());
    expect(textInput('Quantity').value).toBe('7');
    expect(textInput('Remarks').value).toBe('Keep my unsaved notes');
    expect(textInput('Retail Store').value).toBe('');
  });
});

function distributorInputs(): HTMLInputElement[] {
  return Array.from(container.querySelectorAll<HTMLInputElement>('input[role="combobox"][id$="-distributor"]'));
}

function lookupOptionTexts(): string[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).map(
    (option) => option.textContent ?? '',
  );
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await flush();
  }
}

async function searchDistributor(input: HTMLInputElement, text: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    input.focus();
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await waitUntil(
    () =>
      lookupOptionTexts().length > 0 && document.body.querySelector('[role="listbox"][aria-busy]') === null,
  );
}

describe('SaleOrderFormPage Distributor lookup (P1L6)', () => {
  it('picks each group’s Distributor from the bounded lookup and never offers one twice', async () => {
    await renderCreateForm();
    const getCalls = () => vi.mocked(apiClient.get).mock.calls;
    expect(getCalls().some((call) => call[0] === '/distributors')).toBe(false);

    await searchDistributor(distributorInputs()[0]!, 'dist');
    expect(getCalls().find((call) => call[0] === '/distributors/options')?.[1]).toMatchObject({
      params: { search: 'dist', limit: 20 },
    });
    const one = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find((option) =>
      option.textContent?.includes('Distributor One'),
    )!;
    await act(async () => one.click());

    expect(distributorInputs()[0]!.value).toBe('Distributor One');
    expect(container.textContent).toContain('Distributor 1 — Distributor One');
    expect(container.textContent).toContain('Purchase Mode: OUTRIGHT');

    clickButtonByText('+ Add Distributor');
    await flush();
    await searchDistributor(distributorInputs()[1]!, 'dist');
    // Distributor One is already group 1's — only Distributor Two is offered.
    expect(lookupOptionTexts().some((text) => text.includes('Distributor One'))).toBe(false);
    expect(lookupOptionTexts().some((text) => text.includes('Distributor Two'))).toBe(true);
    expect(getCalls().some((call) => call[0] === '/distributors')).toBe(false);
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
  it('hydrates Distributor and Factory even when the Sale Order resolves before the Factory option list', async () => {
    const line1 = {
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
    };
    const so: SaleOrder = {
      id: 'so-1',
      saleOrderNumber: 'EISO/26-27/0001',
      distributors: [{ id: 'dist-1', code: 'D1', name: 'Distributor One', purchaseMode: 'OUTRIGHT' }],
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
      distributorGroups: [
        {
          id: 'group-1',
          distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' },
          purchaseMode: 'OUTRIGHT',
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
              gstin: null,
              canMoveDistributor: true,
            },
          ],
          lines: [line1],
        },
      ],
      lines: [line1],
      fulfillment: { stage: 'AWAITING_PACKING', totalQuantity: 25, totalFactoryPackedQuantity: 0 },
    };

    const factoriesDeferred = deferred<{ data: { data: unknown[] } }>();

    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/sale-orders/so-1') return { data: { data: so } };
      if (url === '/factories/options') return factoriesDeferred.promise;
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
    // Factory option list has not - the exact adverse ordering that
    // triggered the original bug. The Factory select has no options yet, so
    // there is nothing to assert hydrated correctly still.
    const distributorInput = () => distributorInputs()[0]!;
    const factoryTrigger = () => triggerByLabel('Factory');
    expect(factoryTrigger().textContent).not.toContain('Factory One');

    // Now let the option list resolve late.
    await act(async () => {
      factoriesDeferred.resolve({ data: { data: [{ id: 'fac-1', code: 'FAC1', name: 'Factory One', status: 'ACTIVE' }] } });
    });
    await flush();
    await flush();

    // The Distributor lookup is hydrated from the Sale Order's own group —
    // no Distributor master or option request is needed.
    expect(distributorInput().value).toBe('Distributor One');
    expect(container.textContent).toContain('Purchase Mode: OUTRIGHT');
    expect(factoryTrigger().textContent).toContain('Factory One');
    expect(
      vi.mocked(apiClient.get).mock.calls.some((call) => String(call[0]).startsWith('/distributors')),
    ).toBe(false);

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
      if (url === '/factories/options') return { data: { data: [] } };
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
