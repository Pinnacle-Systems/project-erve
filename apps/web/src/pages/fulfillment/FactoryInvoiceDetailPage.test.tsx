/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, Role } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { FactoryInvoiceDetailPage } from './FactoryInvoiceDetailPage.js';
import type { FactoryInvoiceView } from './types.js';

let container: HTMLDivElement;
let root: Root;

function mockAuth(role: Role) {
  const user: AuthUser = { id: 'user-1', email: 'user@test.local', mobile: null, name: 'Test User', roles: [role] };
  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    user,
    token: 'valid-token',
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    isInitializing: false,
  } as unknown as ReturnType<typeof AuthContext.useAuth>);
}

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

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const content = () => container.textContent ?? '';

function buttonByText(text: string): HTMLButtonElement | null {
  return (Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as
    | HTMLButtonElement
    | undefined) ?? null;
}

function inputs(): HTMLInputElement[] {
  return Array.from(container.querySelectorAll('input'));
}

function buildInvoice(overrides: Partial<FactoryInvoiceView> = {}): FactoryInvoiceView {
  return {
    id: 'inv-1',
    status: 'GENERATED',
    version: 1,
    factory: { id: 'fac-1', code: 'FAC1', name: 'Factory One' },
    factoryDispatch: { id: 'fd-1', factoryDispatchNumber: 'EIFD/26-27/0001' },
    saleOrder: { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001' },
    generatedAt: '2026-09-01T00:00:00.000Z',
    factoryConfirmedBy: null,
    factoryConfirmedAt: null,
    finalizedBy: null,
    finalizedAt: null,
    subtotal: 1500,
    gstAmount: 0,
    total: 1500,
    remarks: null,
    lines: [
      {
        id: 'line-1',
        saleOrderLineId: 'sol-1',
        styleId: 'style-1',
        styleNumber: 'ST-001',
        styleName: 'Classic Tee',
        sizeId: 'size-1',
        sizeCode: 'M',
        sizeLabel: 'Medium',
        quantity: 10,
        defaultRate: 150,
        unitRate: 150,
        lineAmount: 1500,
      },
    ],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

async function renderPage(invoice: FactoryInvoiceView, role: Role) {
  mockAuth(role);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/factory-invoices/inv-1') return { data: { data: invoice } };
    throw new Error(`Unexpected GET: ${url}`);
  });

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/fulfillment/factory-invoices/inv-1']}>
          <Routes>
            <Route path="/fulfillment/factory-invoices/:id" element={<FactoryInvoiceDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(() => expect(content()).not.toContain('Loading Factory Invoice'));
}

const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;

function typeInto(input: HTMLInputElement, value: string) {
  act(() => {
    nativeInputValueSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const confirmedBy = { id: 'u1', name: 'Fac User', email: 'f@test.local' };
const accountant = { id: 'u2', name: 'Acc User', email: 'a@test.local' };

function buildConfirmedInvoice(overrides: Partial<FactoryInvoiceView> = {}): FactoryInvoiceView {
  return buildInvoice({
    status: 'FACTORY_CONFIRMED',
    factoryConfirmedBy: confirmedBy,
    factoryConfirmedAt: '2026-09-02T00:00:00.000Z',
    ...overrides,
  });
}

function buildFinalizedInvoice(overrides: Partial<FactoryInvoiceView> = {}): FactoryInvoiceView {
  return buildConfirmedInvoice({
    status: 'FINALIZED',
    finalizedBy: accountant,
    finalizedAt: '2026-09-03T00:00:00.000Z',
    ...overrides,
  });
}

describe('FactoryInvoiceDetailPage — physical fields are always read-only', () => {
  it('never renders Style/Size/Quantity/Default Rate as editable inputs, even while the Accountant is editing', async () => {
    await renderPage(buildInvoice({ status: 'GENERATED' }), 'ACCOUNTANT');
    // Only the Unit Rate (and GST/remarks) fields may be inputs while GENERATED for ACCOUNTANT —
    // assert the physical values render as plain text, not inside any input element.
    expect(content()).toContain('ST-001');
    expect(content()).toContain('Medium');
    expect(inputs().some((i) => i.value === '10')).toBe(false); // quantity never an input
    expect(inputs().some((i) => i.value === '₹150.00')).toBe(false); // default rate never an input
  });
});

describe('FactoryInvoiceDetailPage — FACTORY_USER', () => {
  it('shows the Confirm action only while GENERATED', async () => {
    await renderPage(buildInvoice({ status: 'GENERATED' }), 'FACTORY_USER');
    expect(buttonByText('Confirm Factory Invoice')).not.toBeNull();
  });

  it('hides the Confirm action once already confirmed', async () => {
    await renderPage(buildConfirmedInvoice(), 'FACTORY_USER');
    expect(buttonByText('Confirm Factory Invoice')).toBeNull();
  });

  it('never shows a Save Changes or Finalize action, nor any editable financial input, to FACTORY_USER', async () => {
    await renderPage(buildInvoice({ status: 'GENERATED' }), 'FACTORY_USER');
    expect(buttonByText('Save Changes')).toBeNull();
    expect(buttonByText('Finalize')).toBeNull();
    expect(inputs()).toHaveLength(0);
  });

  it('shows the complete expected invoice — Subtotal, GST and Expected Invoice Total — before confirmation', async () => {
    await renderPage(buildInvoice({ status: 'GENERATED', subtotal: 1500, gstAmount: 75, total: 1575 }), 'FACTORY_USER');
    expect(content()).toContain('Expected Invoice Total');
    expect(content()).toContain('Subtotal');
    expect(content()).toContain('GST');
    expect(content()).toContain('₹1,500.00');
    expect(content()).toContain('₹75.00');
    expect(content()).toContain('₹1,575.00');
    expect(content()).not.toContain('Production Amount (Before GST)');
  });

  it('shows a GST of zero as an actual ₹0.00 figure', async () => {
    await renderPage(buildInvoice({ status: 'GENERATED', subtotal: 1500, gstAmount: 0, total: 1500 }), 'FACTORY_USER');
    expect(content()).toContain('₹0.00');
    expect(content()).toContain('₹1,500.00');
  });

  it('shows the same breakdown, locked, once confirmed', async () => {
    await renderPage(buildConfirmedInvoice({ subtotal: 1500, gstAmount: 75, total: 1575 }), 'FACTORY_USER');
    expect(content()).toContain('₹75.00');
    expect(content()).toContain('₹1,575.00');
    expect(content()).toContain('these values are locked');
  });
});

describe('FactoryInvoiceDetailPage — ADMIN', () => {
  it('shows ADMIN the full Subtotal/GST/Total, read-only with no Confirm or Save action', async () => {
    await renderPage(buildInvoice({ status: 'GENERATED', subtotal: 1500, gstAmount: 75, total: 1575 }), 'ADMIN');
    expect(content()).toContain('₹75.00');
    expect(content()).toContain('₹1,575.00');
    expect(buttonByText('Confirm Factory Invoice')).toBeNull();
    expect(buttonByText('Save Changes')).toBeNull();
    expect(inputs()).toHaveLength(0);
  });
});

describe('FactoryInvoiceDetailPage — ACCOUNTANT', () => {
  it('can edit unit rate, GST and remarks immediately while GENERATED, with Save Changes but no Finalize or Confirm', async () => {
    await renderPage(buildInvoice({ status: 'GENERATED' }), 'ACCOUNTANT');
    expect(inputs().some((i) => i.value === '150')).toBe(true); // unit rate input, prefilled from current value
    expect(inputs().some((i) => i.getAttribute('aria-label') === 'GST amount')).toBe(true);
    expect(inputs().some((i) => i.getAttribute('aria-label') === 'Remarks')).toBe(true);
    expect(buttonByText('Save Changes')).not.toBeNull();
    expect(buttonByText('Finalize')).toBeNull();
    expect(buttonByText('Confirm Factory Invoice')).toBeNull();
    expect(content()).not.toContain('cannot be edited until the Factory confirms');
  });

  it('is fully read-only once FACTORY_CONFIRMED: no inputs, no Save Changes, no Finalize', async () => {
    await renderPage(buildConfirmedInvoice({ subtotal: 1500, gstAmount: 75, total: 1575 }), 'ACCOUNTANT');
    expect(inputs()).toHaveLength(0);
    expect(buttonByText('Save Changes')).toBeNull();
    expect(buttonByText('Finalize')).toBeNull();
    expect(content()).toContain('₹75.00');
    expect(content()).toContain('₹1,575.00');
  });

  it('shows the default rate alongside an overridden unit rate once confirmed (non-editing view)', async () => {
    await renderPage(
      buildConfirmedInvoice({
        lines: [
          { id: 'line-1', saleOrderLineId: 'sol-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', sizeId: 'size-1', sizeCode: 'M', sizeLabel: 'Medium', quantity: 10, defaultRate: 150, unitRate: 200, lineAmount: 2000 },
        ],
      }),
      'ACCOUNTANT',
    );
    expect(content()).toContain('default ₹150.00');
  });

  it('disables Save Changes until a value actually changes', async () => {
    await renderPage(buildInvoice({ status: 'GENERATED' }), 'ACCOUNTANT');
    expect(buttonByText('Save Changes')!.disabled).toBe(true);

    typeInto(inputs().find((i) => i.value === '150')!, '250');
    await flush();

    expect(buttonByText('Save Changes')!.disabled).toBe(false);
  });

  it('sends the current expectedVersion and the changed rate and GST on Save Changes', async () => {
    await renderPage(buildInvoice({ status: 'GENERATED', version: 3 }), 'ACCOUNTANT');
    const patchSpy = vi.spyOn(apiClient, 'patch').mockResolvedValue({
      data: { data: buildInvoice({ status: 'GENERATED', version: 4 }) },
    } as never);

    typeInto(inputs().find((i) => i.value === '150')!, '250');
    typeInto(inputs().find((i) => i.getAttribute('aria-label') === 'GST amount')!, '75.5');
    await flush();
    buttonByText('Save Changes')!.click();
    await flush();

    expect(patchSpy).toHaveBeenCalledWith(
      '/factory-invoices/inv-1/financials',
      expect.objectContaining({ expectedVersion: 3, lines: [{ id: 'line-1', unitRate: 250 }], gstAmount: 75.5 }),
    );
  });

  it('can save a GST of exactly zero', async () => {
    await renderPage(buildInvoice({ status: 'GENERATED', gstAmount: 50, total: 1550 }), 'ACCOUNTANT');
    const patchSpy = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: { data: buildInvoice({ version: 2 }) } } as never);

    typeInto(inputs().find((i) => i.getAttribute('aria-label') === 'GST amount')!, '0');
    await flush();
    expect(buttonByText('Save Changes')!.disabled).toBe(false);
    buttonByText('Save Changes')!.click();
    await flush();

    expect(patchSpy).toHaveBeenCalledWith('/factory-invoices/inv-1/financials', expect.objectContaining({ gstAmount: 0 }));
  });

  it.each([
    ['a negative GST', '-5'],
    ['a GST with more than 2 decimal places', '10.123'],
    ['a blank GST', ''],
  ])('blocks saving %s and says why', async (_label, value) => {
    await renderPage(buildInvoice({ status: 'GENERATED' }), 'ACCOUNTANT');
    typeInto(inputs().find((i) => i.getAttribute('aria-label') === 'GST amount')!, value);
    await flush();

    expect(buttonByText('Save Changes')!.disabled).toBe(true);
    expect(content()).toContain('GST must be zero or more, with at most 2 decimal places');
  });

  it('blocks saving a zero unit rate', async () => {
    await renderPage(buildInvoice({ status: 'GENERATED' }), 'ACCOUNTANT');
    typeInto(inputs().find((i) => i.value === '150')!, '0');
    await flush();

    expect(buttonByText('Save Changes')!.disabled).toBe(true);
    expect(content()).toContain('Unit rates must be greater than zero');
  });

  it('surfaces a server error message on a failed Save Changes', async () => {
    await renderPage(buildInvoice({ status: 'GENERATED' }), 'ACCOUNTANT');
    vi.spyOn(apiClient, 'patch').mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { message: 'The invoice changed since it was loaded' } } },
    });

    typeInto(inputs().find((i) => i.value === '150')!, '250');
    await flush();
    buttonByText('Save Changes')!.click();
    await flush();

    expect(content()).toContain('The invoice changed since it was loaded');
  });
});

describe('FactoryInvoiceDetailPage — legacy FINALIZED records', () => {
  it('stay readable and fully read-only for every role, labelled legacy', async () => {
    await renderPage(buildFinalizedInvoice({ subtotal: 1500, gstAmount: 75, total: 1575 }), 'ACCOUNTANT');
    expect(content()).toContain('Finalized (legacy)');
    expect(content()).toContain('Acc User');
    expect(content()).toContain('₹75.00');
    expect(content()).toContain('₹1,575.00');
    expect(inputs()).toHaveLength(0);
    expect(buttonByText('Save Changes')).toBeNull();
    expect(buttonByText('Finalize')).toBeNull();
  });

  it('shows no Confirm action to FACTORY_USER', async () => {
    await renderPage(buildFinalizedInvoice(), 'FACTORY_USER');
    expect(buttonByText('Confirm Factory Invoice')).toBeNull();
  });
});

describe('FactoryInvoiceDetailPage — ISS-010 Style-level financial grouping', () => {
  function multiSizeInvoice(overrides: Partial<FactoryInvoiceView> = {}): FactoryInvoiceView {
    return buildInvoice({
      status: 'FACTORY_CONFIRMED',
      factoryConfirmedBy: confirmedBy,
      factoryConfirmedAt: '2026-09-02T00:00:00.000Z',
      subtotal: 3000,
      total: 3000,
      lines: [
        { id: 'line-1', saleOrderLineId: 'sol-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', sizeId: 'size-s', sizeCode: 'S', sizeLabel: 'Small', quantity: 10, defaultRate: 100, unitRate: 100, lineAmount: 1000 },
        { id: 'line-2', saleOrderLineId: 'sol-2', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', sizeId: 'size-m', sizeCode: 'M', sizeLabel: 'Medium', quantity: 20, defaultRate: 100, unitRate: 100, lineAmount: 2000 },
      ],
      ...overrides,
    });
  }

  it('collapses a Style packed in multiple Sizes into a single financial row with a Size Breakdown and summed Amount', async () => {
    await renderPage(multiSizeInvoice(), 'FACTORY_USER');
    // Style text appears exactly once as a row label (not once per Size).
    expect(content().match(/ST-001/g)?.length).toBe(1);
    expect(content()).toContain('Small: 10');
    expect(content()).toContain('Medium: 20');
    expect(content()).toContain('₹3,000.00'); // summed line amount for the group
  });

  it('keeps the ungrouped, per-line editable table for ACCOUNTANT while actively editing (GENERATED)', async () => {
    await renderPage(multiSizeInvoice({ status: 'GENERATED', factoryConfirmedBy: null, factoryConfirmedAt: null }), 'ACCOUNTANT');
    // Two separate editable Unit Rate inputs — one per source line — proving grouping is bypassed here.
    expect(inputs().filter((i) => i.value === '100')).toHaveLength(2);
  });
});

describe('FactoryInvoiceDetailPage PDF print (Phase 6)', () => {
  it('no longer renders the legacy bare "Print" window.print() button label without the PDF action pair', async () => {
    await renderPage(buildInvoice(), 'ACCOUNTANT');
    expect(buttonByText('Print')).not.toBeNull();
    expect(buttonByText('Download PDF')).not.toBeNull();
  });

  it('clicking Print never calls the top-level window.print() (the legacy path)', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    await renderPage(buildInvoice(), 'ACCOUNTANT');

    buttonByText('Print')!.click();
    await flush();
    await flush();

    // The new pipeline prints a real generated PDF Blob through a hidden iframe's OWN
    // contentWindow.print() (see lib/pdf/print.ts) — it never calls the top-level window.print(),
    // which is exactly the legacy call this phase removes from FactoryInvoiceDetailPage.tsx itself.
    expect(printSpy).not.toHaveBeenCalled();
  });
});

// UXAUTH-018: a failed fetch (403/500/network error) must render the real
// ErrorState, not fall through to the "Factory Invoice not found" EmptyState
// — that EmptyState is reserved for a genuine no-such-record response.
describe('FactoryInvoiceDetailPage load error handling (UXAUTH-018)', () => {
  it('shows an error state, not a not-found/empty state, when the request fails', async () => {
    mockAuth('ACCOUNTANT');
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/factory-invoices/inv-1') throw new Error('Request failed with status code 500');
      throw new Error(`Unexpected GET: ${url}`);
    });

    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={['/fulfillment/factory-invoices/inv-1']}>
            <Routes>
              <Route path="/fulfillment/factory-invoices/:id" element={<FactoryInvoiceDetailPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => expect(content()).not.toContain('Loading Factory Invoice'));

    expect(content()).not.toContain('Factory Invoice not found');
    expect(content()).toContain('Unable to load Factory Invoice');
    expect(content()).toContain('Request failed with status code 500');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});

describe('Factory Invoice confirmation safety', () => {
  function openConfirmDialog() {
    act(() => buttonByText('Confirm Factory Invoice')!.click());
    return vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
  }

  function dialogConfirmButton() {
    return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(
      (b) => b.textContent === 'Confirm Factory Invoice',
    )!;
  }

  it('shows the exact saved Subtotal, GST and Expected Invoice Total in the confirmation dialog', async () => {
    const post = vi.spyOn(apiClient, 'post');
    await renderPage(buildInvoice({ status: 'GENERATED', subtotal: 1500, gstAmount: 75, total: 1575 }), 'FACTORY_USER');
    await openConfirmDialog();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('EIFD/26-27/0001');
    expect(dialog.textContent).toContain('Subtotal ₹1,500.00');
    expect(dialog.textContent).toContain('GST ₹75.00');
    expect(dialog.textContent).toContain('Expected Invoice Total ₹1,575.00');
    expect(post).not.toHaveBeenCalled();

    const exit = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Continue Reviewing');
    act(() => exit!.click());
    expect(post).not.toHaveBeenCalled();
  });

  it('submits the Factory confirmation with the reviewed version only after confirming the dialog', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: buildConfirmedInvoice({ version: 8 }) } } as never);
    await renderPage(buildInvoice({ status: 'GENERATED', version: 7 }), 'FACTORY_USER');
    await openConfirmDialog();
    expect(post).not.toHaveBeenCalled();
    act(() => dialogConfirmButton().click());
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/factory-invoices/inv-1/confirm', { expectedVersion: 7 }));
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  });

  it('on a stale 409, closes the dialog, reloads the invoice and requires a fresh confirmation click', async () => {
    const post = vi
      .spyOn(apiClient, 'post')
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: {
          data: { error: { code: 'STALE_VERSION', message: 'This Factory Invoice was updated after you opened it. Review the latest values and try again.' } },
        },
      })
      .mockResolvedValue({ data: { data: buildConfirmedInvoice({ version: 4 }) } } as never);
    await renderPage(buildInvoice({ status: 'GENERATED', version: 1, subtotal: 1500, gstAmount: 0, total: 1500 }), 'FACTORY_USER');
    const getSpy = vi.mocked(apiClient.get);
    // Accounts saves GST while the reviewer still has the old page open: the reload returns the new version.
    getSpy.mockImplementation(async (url: string) => {
      if (url === '/factory-invoices/inv-1') {
        return { data: { data: buildInvoice({ status: 'GENERATED', version: 3, subtotal: 1500, gstAmount: 75, total: 1575 }) } };
      }
      throw new Error(`Unexpected GET: ${url}`);
    });

    await openConfirmDialog();
    act(() => dialogConfirmButton().click());
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/factory-invoices/inv-1/confirm', { expectedVersion: 1 }));

    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    await vi.waitFor(() => expect(content()).toContain('₹1,575.00')); // reloaded values on screen
    expect(content()).toContain('This Factory Invoice was updated after you opened it');
    expect(post).toHaveBeenCalledTimes(1); // never auto-retried

    await openConfirmDialog();
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Expected Invoice Total ₹1,575.00');
    act(() => dialogConfirmButton().click());
    await vi.waitFor(() => expect(post).toHaveBeenLastCalledWith('/factory-invoices/inv-1/confirm', { expectedVersion: 3 }));
  });

  it('keeps the dialog open and shows a retryable server error for a non-stale failure', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { code: 'FORBIDDEN', message: 'You do not have access to this Factory Invoice' } } },
    });
    await renderPage(buildInvoice({ status: 'GENERATED' }), 'FACTORY_USER');
    await openConfirmDialog();
    act(() => dialogConfirmButton().click());
    const dialog = document.querySelector('[role="dialog"]')!;
    await vi.waitFor(() => expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('You do not have access'));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
