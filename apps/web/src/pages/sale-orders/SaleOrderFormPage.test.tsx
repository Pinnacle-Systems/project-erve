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
  await flush();
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
    if (url === '/job-orders/pooled-inventory/style-options') {
      return { data: { data: { items: [{ styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', lmixNumber: 'LMIX-1', primaryImage: null }], pageInfo: { limit: 20, hasMore: false, nextCursor: null } } } };
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
              primaryImage: null,
              sizeId: 'size-1',
              sizeCode: 'M',
              sizeLabel: 'Medium',
              sizeSortOrder: 1,
              releasedQuantity: 100,
              committedQuantity: 0,
              availableQuantity: 100,
            },
          ],
        },
      };
    }
    if (url === '/styles/style-1') {
      // DEMO-016 fix: a Style's configured ACTIVE Sizes may exceed the
      // Factory's pooled inventory above (which only has size-1) — size-2
      // is configured but has never had pooled stock here, and must still
      // show up in DispatchOrderQuantityGrid's divisor (see the dedicated
      // regression test below).
      return {
        data: {
          data: {
            id: 'style-1',
            sizes: [
              { id: 'size-1', code: 'M', label: 'Medium', sizeType: 'ALPHA', sortOrder: 1, status: 'ACTIVE', mappingStatus: 'ACTIVE' },
              { id: 'size-2', code: 'L', label: 'Large', sizeType: 'ALPHA', sortOrder: 2, status: 'ACTIVE', mappingStatus: 'ACTIVE' },
            ],
          },
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
  it('aligns the Style lookup, Total Quantity and Remove controls in a responsive row', async () => {
    await renderCreateForm();
    await selectOption('Factory', 'Factory One');
    await act(async () => clickButtonByText('+ Add Style'));
    const remove = [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Remove');
    expect(remove).toBeDefined();
    const controls = remove!.parentElement!;
    expect(controls.className).toContain('grid-cols-1');
    expect(controls.className).toContain('items-end');
    expect(controls.textContent).toContain('Style');
    expect(controls.textContent).toContain('Total Quantity');
  });

  it('never loads a full Factory pool and deduplicates selected Style hydration across destinations', async () => {
    await renderCreateForm();
    await selectOption('Factory', 'Factory One'); await flush();
    expect(vi.mocked(apiClient.get).mock.calls.filter(c => c[0] === '/job-orders/pooled-inventory')).toHaveLength(0);
    await act(async () => clickButtonByText('+ Add Style'));
    await chooseStyle('Classic Tee'); await flush();
    const pools = () => vi.mocked(apiClient.get).mock.calls.filter(c => c[0] === '/job-orders/pooled-inventory');
    expect(pools()).toHaveLength(1);
    expect(pools()[0]?.[1]?.params).toMatchObject({ factoryId: 'fac-1', styleId: 'style-1' });
    await setNumericField('Total Quantity', '20');
    await act(async () => clickButtonByText('+ Add Destination')); await flush();
    const add = [...container.querySelectorAll('button')].filter(b => b.textContent?.trim() === '+ Add Style').at(-1)!;
    await act(async () => add.click()); await flush();
    await selectOption('Style', 'Classic Tee', 1); await flush();
    expect(pools()).toHaveLength(1);
    expect(textInput('Total Quantity').value).toBe('20');
  });

  it('deducts the same pooled Sizes across destinations and restores stock after an edit (ISS-094)', async () => {
    await renderCreateForm();
    const originalGet = vi.mocked(apiClient.get).getMockImplementation()!;
    vi.mocked(apiClient.get).mockImplementation(async (...args) => {
      if (args[0] === '/job-orders/pooled-inventory') {
        const response = await originalGet(...args) as { data: { data: Array<Record<string, unknown>> } };
        const base = response.data.data[0]!;
        return { data: { data: [
          { ...base, availableQuantity: 8 },
          { ...base, sizeId: 'size-2', sizeCode: 'L', sizeLabel: 'Large', sizeSortOrder: 2, availableQuantity: 8 },
        ] } };
      }
      return originalGet(...args);
    });
    await selectOption('Factory', 'Factory One');
    await act(async () => clickButtonByText('+ Add Style'));
    await chooseStyle('Classic Tee');
    await flush();
    expect(container.textContent).toContain('Medium: 8 remaining (8 available; 0 in draft)');

    await setNumericField('Total Quantity', '2');
    await flush();
    expect(container.textContent).toContain('Medium: 7 remaining (8 available; 1 in draft)');

    await act(async () => clickButtonByText('+ Add Destination'));
    await flush();
    const add = [...container.querySelectorAll('button')].filter((b) => b.textContent?.trim() === '+ Add Style').at(-1)!;
    await act(async () => add.click());
    await chooseStyle('Classic Tee', 1);
    await flush();

    const quantityInputs = () => [...container.querySelectorAll<HTMLInputElement>('input[id$="-total-quantity"]')];
    expect(quantityInputs()).toHaveLength(2);
    const editSecond = async (value: string) => {
      await act(async () => {
        const input = quantityInputs()[1]!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('focusout', { bubbles: true }));
      });
      await flush();
    };

    await editSecond('12');
    // Each destination shows the SAME current shared pool, not a fresh 8.
    expect(container.textContent).toContain('Medium: 1 remaining (8 available; 7 in draft)');
    expect(container.textContent).toContain('Large: 1 remaining (8 available; 7 in draft)');

    await editSecond('18');
    expect(container.textContent).toContain('Size M: 10 requested, 8 available; reduce by 2.');
    expect(container.textContent).toContain('short by 4 unit(s)');
    const create = [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Create Dispatch Order')!;
    expect(create.disabled).toBe(true);

    await editSecond('4');
    expect(container.textContent).toContain('Medium: 5 remaining (8 available; 3 in draft)');
    expect(create.disabled).toBe(false);

    // Clearing the second destination gives the first one its stock back.
    await editSecond('');
    expect(container.textContent).toContain('Medium: 7 remaining (8 available; 1 in draft)');
  });

  it('shows hydration failure as unknown availability with an actionable retry', async () => {
    await renderCreateForm();
    const original = vi.mocked(apiClient.get).getMockImplementation()!;
    let failed = true;
    vi.mocked(apiClient.get).mockImplementation(async (...args) => {
      if (args[0] === '/job-orders/pooled-inventory' && failed) throw new Error('offline');
      return original(...args);
    });
    await selectOption('Factory', 'Factory One'); await flush();
    await act(async () => clickButtonByText('+ Add Style')); await chooseStyle('Classic Tee'); await flush(); await flush();
    expect(container.textContent).toContain('Unable to load Style availability');
    expect(container.textContent).not.toContain('0 available');
    expect(textInput('Style').value).toContain('ST-001');
    failed = false;
    await act(async () => clickButtonByText('Retry availability')); await flush(); await flush();
    expect(container.textContent).toContain('100 available');
  });
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

    // Add a second destination and a second Style line on it, so the
    // page renders two of every destination-level field and two of every
    // line-level field at once.
    clickButtonByText('+ Add Destination');
    await flush();
    clickButtonByText('+ Add Style'); // Destination 1's line (first match).
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

// DEMO-016 fix regression (frontend/backend consistency): the Style's
// configured ACTIVE Sizes (GET /styles/:id) may include a Size the
// Factory's pooled inventory has never carried — that Size must still
// appear in the equal-split preview and its divisor, matching
// resolveEligibleSizeIds on the server, never silently vanish the way a
// pooled-inventory-only Size list would.
describe('SaleOrderFormPage — equal-split preview includes configured Sizes with no pooled stock (DEMO-016)', () => {
  it('shows the Style\'s configured-only Size in the grid and requires the total to divide across both', async () => {
    await renderCreateForm();
    await selectOption('Factory', 'Factory One');
    await flush();
    await act(async () => clickButtonByText('+ Add Style'));
    await chooseStyle('Classic Tee');
    await flush();
    await flush();

    // size-2 (Large) has zero pooled stock at this Factory but is an
    // ACTIVE configured Size for this Style — it must render in the
    // preview grid, not just size-1 (Medium).
    expect(container.textContent).toContain('Large');
    expect(container.textContent).toContain('0 available');

    // An odd total doesn't divide evenly across the real 2-Size divisor —
    // must be rejected by the client-side preview exactly like the server
    // would reject it.
    await setNumericField('Total Quantity', '7');
    await flush();
    expect(container.textContent).toMatch(/does not divide evenly across 2 Size/);

    await setNumericField('Total Quantity', '20');
    await flush();
    expect(container.textContent).not.toMatch(/does not divide evenly/);
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
// NumericField commits on blur, not on every keystroke — input and focusout
// must fire within the SAME act() call (splitting them across two act()
// calls races NumericField's own state update; see JobOrderProductionTab's
// identical NumericField test gotcha).
async function setNumericField(label: string, value: string, scope: ParentNode = container) {
  await act(async () => {
    const el = textInput(label, scope);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('focusout', { bubbles: true }));
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
async function chooseStyle(name: string, occurrence = 0) {
  const lookup = triggerByLabel('Style', occurrence) as unknown as HTMLInputElement;
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
  await act(async () => clickButtonByText('+ Add Style'));
  await chooseStyle('Classic Tee');
  await setNumericField('Total Quantity', '7');
  // ISS-100: no Retail Store has been selected yet, so submitting here hits
  // the client-side "Retail Store required" validation — keep that real
  // parent validation error showing while creating the missing Store.
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
    // ISS-100: the initial submit inside prepareInline() is now blocked by
    // client-side "Retail Store required" validation before any network
    // call happens — the first real apiClient.post call is the inline Store
    // creation itself.
    vi.spyOn(apiClient, 'post').mockImplementationOnce(() => pending.promise);
    await prepareInline();
    const dialog = await fillInline();
    await act(async () => dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => clickButtonByText('+ Create new Retail Store'));
    const reopened = document.body.querySelector('[role="dialog"]')!;
    await typeText('Store Name', 'Second Store', reopened);

    await act(async () => pending.resolve({ data: { data: { id: 'canceled', distributorId: 'dist-1', code: 'FIRST', name: 'Canceled Store', addressLine1: 'Canceled address', city: 'Chennai', state: 'TN', country: 'India', postalCode: '600001', status: 'ACTIVE' } } }));
    await flush();
    expect(document.body.querySelector('[role="dialog"]')).toBe(reopened);
    expect(textInput('Store Name', reopened).value).toBe('Second Store');
    expect(textInput('Retail Store').value).toBe('');
    expect(textInput('Total Quantity').value).toBe('7');
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
    // ISS-100: the initial submit inside prepareInline() never reaches
    // /sale-orders any more — it's blocked client-side by "Retail Store
    // required" validation before any network call happens.
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({
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
    });
    await prepareInline();
    const parent = container.querySelector('form')!;
    expect(container.textContent).toContain('Select a Retail Store for every destination before saving');
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
    expect(textInput('Total Quantity').value).toBe('7');
    expect(textInput('Retail Store').value).toContain('New Store');
    expect(textInput('Address Line 1').value).toBe('New Address');
    expect(container.textContent).toContain('Select a Retail Store for every destination before saving');
    expect(post.mock.calls).toHaveLength(1);
    expect(post.mock.calls.filter(([url]) => url === '/sale-orders')).toHaveLength(0);
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
    expect(textInput('Store Name', dialog).value).toBe('New Store');
    expect(textInput('Remarks').value).toBe('Keep my unsaved notes');
    const cancel = Array.from(dialog.querySelectorAll('button')).find(
      (e) => e.textContent === 'Cancel',
    )!;
    await act(async () => cancel.click());
    expect(textInput('Total Quantity').value).toBe('7');
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

describe('SaleOrderFormPage inline Factory/Distributor creation (DEMO-015)', () => {
  it('creates a Factory inline and selects it without leaving the form', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: { data: { id: 'fac-new', code: 'FAC2', name: 'Factory Two', status: 'ACTIVE' } },
    });
    await renderCreateForm();
    clickButtonByText('+ Create new Factory');
    await flush();

    await typeText('Name', 'Factory Two', document.body);
    await act(async () => {
      document.body.querySelector('[role="dialog"] form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(post).toHaveBeenCalledWith('/factories', expect.objectContaining({ name: 'Factory Two' }));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect((triggerByLabel('Factory') as unknown as HTMLInputElement).value).toContain('Factory Two');
  });

  it('creates a Distributor inline for a group and selects it without resetting other groups', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: { data: { id: 'dist-new', code: 'D3', name: 'Distributor Three', purchaseMode: 'OUTRIGHT', status: 'ACTIVE' } },
    });
    await renderCreateForm();
    clickButtonByText('+ Create new Distributor');
    await flush();

    await typeText('Name', 'Distributor Three', document.body);
    await typeText('GSTIN', '22AAAAA0000A1Z5', document.body);
    await act(async () => {
      document.body.querySelector('[role="dialog"] form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(post).toHaveBeenCalledWith(
      '/distributors',
      expect.objectContaining({ name: 'Distributor Three', gstin: '22AAAAA0000A1Z5' }),
    );
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(distributorInputs()[0]!.value).toBe('Distributor Three');
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
      primaryImage: null,
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
    const factoryInput = () => triggerByLabel('Factory') as unknown as HTMLInputElement;
    expect(factoryInput().value).not.toContain('Factory One');

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
    expect(factoryInput().value).toContain('Factory One');
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

// BUG-007 follow-up: excludeSaleOrderId must only be sent while editing at
// this order's ORIGINAL Factory — switching Factory reallocates against a
// different pool entirely, where this order holds no reservation to add
// back (the backend now 400s a mismatched exclusion; the fix is the form
// never sending one once Factory changes).
describe('SaleOrderFormPage edit — excludeSaleOrderId tracks the original Factory (BUG-007 follow-up)', () => {
  function makeSaleOrder(): SaleOrder {
    const line1 = {
      id: 'line-1',
      destinationId: 'dest-1',
      styleId: 'style-1',
      styleNumber: 'ST-001',
      styleName: 'Classic Tee',
      primaryImage: null,
      sizeId: 'size-1',
      sizeCode: 'M',
      sizeLabel: 'Medium',
      quantity: 25,
      remarks: null,
    };
    return {
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
  }

  async function renderEditForm(pool?: (params: Record<string, unknown>) => Promise<unknown[]>) {
    const so = makeSaleOrder();
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
      if (url === '/sale-orders/so-1') return { data: { data: so } };
      if (url === '/factories/options') {
        return {
          data: {
            data: [
              { id: 'fac-1', code: 'FAC1', name: 'Factory One', status: 'ACTIVE' },
              { id: 'fac-2', code: 'FAC2', name: 'Factory Two', status: 'ACTIVE' },
            ],
          },
        };
      }
      if (url === '/job-orders/pooled-inventory') return { data: { data: pool ? await pool(config?.params ?? {}) : [] } };
      if (url === '/styles/style-1') return { data: { data: { sizes: [{ id: 'configured', code: 'L', label: 'Configured Large', sortOrder: 2, status: 'ACTIVE', mappingStatus: 'ACTIVE' }] } } };
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
  }

  function lastPooledInventoryParams(): Record<string, unknown> | undefined {
    const calls = vi
      .mocked(apiClient.get)
      .mock.calls.filter((call) => call[0] === '/job-orders/pooled-inventory');
    return (calls.at(-1)?.[1] as { params?: Record<string, unknown> } | undefined)?.params;
  }

  it('sends excludeSaleOrderId while still editing at the original Factory', async () => {
    await renderEditForm();
    expect(lastPooledInventoryParams()).toMatchObject({ factoryId: 'fac-1', styleId: 'style-1', excludeSaleOrderId: 'so-1' });
  });

  it('retains saved zero-stock identity and configured/historical Sizes independently of discovery', async () => {
    await renderEditForm(async () => [{ factoryId: 'fac-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: null, sizeId: 'historical', sizeCode: 'OLD', sizeLabel: 'Historical exhausted', sizeSortOrder: 1, availableQuantity: 0 }]);
    await flush();
    expect(textInput('Style').value).toContain('ST-001');
    expect(container.textContent).toContain('Historical exhausted');
    expect(container.textContent).toContain('Configured Large');
    expect(textInput('Total Quantity').value).toBe('25');
    expect(vi.mocked(apiClient.get).mock.calls.some(c => c[0] === '/job-orders/pooled-inventory/style-options')).toBe(false);
  });

  it('ignores late old-Factory inventory and preserves draft quantities after Factory switching', async () => {
    let resolve!: (rows: unknown[]) => void;
    const row = (availableQuantity: number) => ({ factoryId: 'fac-2', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: null, sizeId: 'historical', sizeCode: 'OLD', sizeLabel: 'Historical', sizeSortOrder: 1, availableQuantity });
    await renderEditForm(async params => params.factoryId === 'fac-1' ? new Promise(r => { resolve = r; }) : [row(7)]);
    await setNumericField('Total Quantity', '40');
    await selectOption('Factory', 'Factory Two'); await flush(); await flush();
    await act(async () => resolve([row(99)])); await flush();
    expect(container.textContent).toContain('7 available');
    expect(container.textContent).not.toContain('99 available');
    expect(textInput('Total Quantity').value).toBe('40');
    expect(lastPooledInventoryParams()).toMatchObject({ factoryId: 'fac-2', styleId: 'style-1' });
    expect(lastPooledInventoryParams()?.excludeSaleOrderId).toBeUndefined();
  });

  it('omits excludeSaleOrderId once the user switches to a different Factory', async () => {
    await renderEditForm();
    await selectOption('Factory', 'Factory Two');
    await flush();

    const params = lastPooledInventoryParams();
    expect(params?.factoryId).toBe('fac-2');
    expect(params?.excludeSaleOrderId).toBeUndefined();
  });

  it('re-applies excludeSaleOrderId after switching back to the original Factory', async () => {
    await renderEditForm();
    await selectOption('Factory', 'Factory Two');
    await flush();
    await selectOption('Factory', 'Factory One');
    await flush();

    expect(lastPooledInventoryParams()).toMatchObject({ factoryId: 'fac-1', excludeSaleOrderId: 'so-1' });
  });
});
