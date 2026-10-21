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

describe('FactoryInvoiceDetailPage — physical fields are always read-only', () => {
  it('never renders Style/Size/Quantity/Default Rate as editable inputs, regardless of role or status', async () => {
    await renderPage(buildInvoice({ status: 'FACTORY_CONFIRMED' }), 'ACCOUNTANT');
    // Only the Unit Rate (and GST/remarks) fields may be inputs while
    // FACTORY_CONFIRMED for ACCOUNTANT — assert the physical values render
    // as plain text, not inside any input element.
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
    await renderPage(
      buildInvoice({ status: 'FACTORY_CONFIRMED', factoryConfirmedBy: { id: 'u1', name: 'Fac User', email: 'f@test.local' }, factoryConfirmedAt: '2026-09-02T00:00:00.000Z' }),
      'FACTORY_USER',
    );
    expect(buttonByText('Confirm Factory Invoice')).toBeNull();
  });

  it('never shows a Save Changes or Finalize action to FACTORY_USER', async () => {
    await renderPage(buildInvoice({ status: 'FACTORY_CONFIRMED' }), 'FACTORY_USER');
    expect(buttonByText('Save Changes')).toBeNull();
    expect(buttonByText('Finalize')).toBeNull();
  });
});

describe('FactoryInvoiceDetailPage — ACCOUNTANT', () => {
  it('shows a read-only Awaiting Factory Confirmation state while GENERATED, with no edit controls', async () => {
    await renderPage(buildInvoice({ status: 'GENERATED' }), 'ACCOUNTANT');
    expect(content()).toContain('Awaiting Factory Confirmation');
    expect(buttonByText('Save Changes')).toBeNull();
    expect(buttonByText('Finalize')).toBeNull();
    expect(buttonByText('Confirm Factory Invoice')).toBeNull();
  });

  it('shows editable unit rate/GST/remarks and Save Changes + Finalize once FACTORY_CONFIRMED', async () => {
    await renderPage(buildInvoice({ status: 'FACTORY_CONFIRMED' }), 'ACCOUNTANT');
    expect(inputs().some((i) => i.value === '150')).toBe(true); // unit rate input, prefilled from current value
    expect(buttonByText('Save Changes')).not.toBeNull();
    expect(buttonByText('Finalize')).not.toBeNull();
  });

  it('shows the default rate alongside an overridden unit rate once finalized (non-editing view)', async () => {
    await renderPage(
      buildInvoice({
        status: 'FINALIZED',
        finalizedBy: { id: 'u2', name: 'Acc User', email: 'a@test.local' },
        finalizedAt: '2026-09-03T00:00:00.000Z',
        lines: [
          { id: 'line-1', saleOrderLineId: 'sol-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', sizeId: 'size-1', sizeCode: 'M', sizeLabel: 'Medium', quantity: 10, defaultRate: 150, unitRate: 200, lineAmount: 2000 },
        ],
      }),
      'ACCOUNTANT',
    );
    expect(content()).toContain('default ₹150.00');
  });

  it('disables Save Changes until a value actually changes', async () => {
    await renderPage(buildInvoice({ status: 'FACTORY_CONFIRMED' }), 'ACCOUNTANT');
    expect(buttonByText('Save Changes')!.disabled).toBe(true);

    const rateInput = inputs().find((i) => i.value === '150')!;
    act(() => {
      rateInput.dispatchEvent(new Event('focus', { bubbles: true }));
    });
    // Simulate a user edit via React's change event.
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      nativeInputValueSetter.call(rateInput, '250');
      rateInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();

    expect(buttonByText('Save Changes')!.disabled).toBe(false);
  });

  it('sends the current expectedVersion and changed fields on Save Changes', async () => {
    await renderPage(buildInvoice({ status: 'FACTORY_CONFIRMED', version: 3 }), 'ACCOUNTANT');
    const patchSpy = vi.spyOn(apiClient, 'patch').mockResolvedValue({
      data: { data: buildInvoice({ status: 'FACTORY_CONFIRMED', version: 4 }) },
    } as never);

    const rateInput = inputs().find((i) => i.value === '150')!;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      nativeInputValueSetter.call(rateInput, '250');
      rateInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();
    buttonByText('Save Changes')!.click();
    await flush();

    expect(patchSpy).toHaveBeenCalledWith(
      '/factory-invoices/inv-1/financials',
      expect.objectContaining({ expectedVersion: 3, lines: [{ id: 'line-1', unitRate: 250 }] }),
    );
  });

  it('surfaces a server error message on a failed Save Changes', async () => {
    await renderPage(buildInvoice({ status: 'FACTORY_CONFIRMED' }), 'ACCOUNTANT');
    vi.spyOn(apiClient, 'patch').mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { message: 'The invoice changed since it was loaded' } } },
    });

    const rateInput = inputs().find((i) => i.value === '150')!;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      nativeInputValueSetter.call(rateInput, '250');
      rateInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();
    buttonByText('Save Changes')!.click();
    await flush();

    expect(content()).toContain('The invoice changed since it was loaded');
  });

  it('rejects finalizing a not-yet-confirmed invoice at the UI level by never showing Finalize', async () => {
    await renderPage(buildInvoice({ status: 'GENERATED' }), 'ACCOUNTANT');
    expect(buttonByText('Finalize')).toBeNull();
  });
});

describe('FactoryInvoiceDetailPage — ISS-025 pre-tax Factory confirmation', () => {
  // --- FACTORY_USER: pre-tax only while not FINALIZED, real GST once FINALIZED ---

  it('shows a plain pre-tax Production Amount to FACTORY_USER on a GENERATED invoice, never a misleading GST ₹0.00 row', async () => {
    await renderPage(buildInvoice({ status: 'GENERATED', subtotal: 1500, gstAmount: 0, total: 1500 }), 'FACTORY_USER');
    expect(content()).toContain('Factory Amount Confirmation');
    expect(content()).toContain('Production Amount (Before GST)');
    expect(content()).toContain('₹1,500.00');
    expect(content()).not.toContain('₹0.00');
    expect(buttonByText('Confirm Factory Invoice')).not.toBeNull();
  });

  it('keeps FACTORY_USER on the plain pre-tax amount at FACTORY_CONFIRMED too — GST is still not settled until FINALIZED', async () => {
    await renderPage(
      buildInvoice({
        status: 'FACTORY_CONFIRMED',
        subtotal: 1500,
        gstAmount: 75, // Accountant has started entering a value, but it's still not final
        total: 1575,
        factoryConfirmedBy: { id: 'u1', name: 'Fac User', email: 'f@test.local' },
        factoryConfirmedAt: '2026-09-02T00:00:00.000Z',
      }),
      'FACTORY_USER',
    );
    // No longer "Factory Amount Confirmation" (nothing left to confirm), but still the plain pre-tax framing.
    expect(content()).toContain('Production Amount (Before GST)');
    expect(content()).toContain('₹1,500.00');
    expect(content()).not.toContain('₹75.00'); // the in-progress GST figure is not shown to this viewer yet
    expect(buttonByText('Confirm Factory Invoice')).toBeNull();
  });

  it('shows the real, finalized GST/Total breakdown to FACTORY_USER once the invoice is FINALIZED', async () => {
    await renderPage(
      buildInvoice({
        status: 'FINALIZED',
        subtotal: 1500,
        gstAmount: 75,
        total: 1575,
        factoryConfirmedBy: { id: 'u1', name: 'Fac User', email: 'f@test.local' },
        factoryConfirmedAt: '2026-09-02T00:00:00.000Z',
        finalizedBy: { id: 'u2', name: 'Acc User', email: 'a@test.local' },
        finalizedAt: '2026-09-03T00:00:00.000Z',
      }),
      'FACTORY_USER',
    );
    expect(content()).not.toContain('Factory Amount Confirmation');
    expect(content()).not.toContain('Production Amount (Before GST)');
    expect(content()).toContain('₹75.00');
    expect(content()).toContain('₹1,575.00');
    expect(content()).not.toContain('Provisional');
  });

  it('shows a legitimate finalized GST of zero to FACTORY_USER as an actual ₹0.00 figure, not hidden or pre-tax-only', async () => {
    await renderPage(
      buildInvoice({
        status: 'FINALIZED',
        subtotal: 1500,
        gstAmount: 0,
        total: 1500,
        finalizedBy: { id: 'u2', name: 'Acc User', email: 'a@test.local' },
        finalizedAt: '2026-09-03T00:00:00.000Z',
      }),
      'FACTORY_USER',
    );
    expect(content()).not.toContain('Production Amount (Before GST)');
    expect(content()).toContain('Subtotal');
    expect(content()).toContain('₹0.00');
  });

  // --- ADMIN: same non-Accountant treatment as FACTORY_USER ---

  it('shows the same plain pre-tax confirmation to ADMIN (a read-only, non-Accountant viewer) on a GENERATED invoice', async () => {
    await renderPage(buildInvoice({ status: 'GENERATED' }), 'ADMIN');
    expect(content()).toContain('Production Amount (Before GST)');
    expect(content()).not.toContain('₹0.00');
  });

  it('keeps ADMIN on the plain pre-tax amount at FACTORY_CONFIRMED too', async () => {
    await renderPage(buildInvoice({ status: 'FACTORY_CONFIRMED', gstAmount: 40, total: 1540 }), 'ADMIN');
    expect(content()).toContain('Production Amount (Before GST)');
    expect(content()).not.toContain('₹40.00');
  });

  it('shows ADMIN the real breakdown once FINALIZED', async () => {
    await renderPage(buildInvoice({ status: 'FINALIZED', gstAmount: 40, total: 1540 }), 'ADMIN');
    expect(content()).not.toContain('Production Amount (Before GST)');
    expect(content()).toContain('₹40.00');
  });

  // --- ACCOUNTANT: always the full, editable breakdown; marked provisional pre-finalization ---

  it('still shows the full Subtotal/GST/Total breakdown to ACCOUNTANT on a GENERATED invoice, marked Provisional', async () => {
    await renderPage(buildInvoice({ status: 'GENERATED' }), 'ACCOUNTANT');
    expect(content()).toContain('Subtotal');
    expect(content()).toContain('₹0.00'); // the real (not-yet-set) GST value, visible to the role authorized to set it
    expect(content()).not.toContain('Factory Amount Confirmation');
    expect(content()).toContain('Provisional');
  });

  it('shows the full breakdown to ACCOUNTANT at FACTORY_CONFIRMED, editable and marked Provisional', async () => {
    await renderPage(buildInvoice({ status: 'FACTORY_CONFIRMED', gstAmount: 75, total: 1575 }), 'ACCOUNTANT');
    expect(content()).toContain('Provisional');
    expect(content()).toContain('₹1,575.00');
  });

  it('a recorded GST of exactly zero at FACTORY_CONFIRMED remains in the editable input, never treated as missing', async () => {
    await renderPage(buildInvoice({ status: 'FACTORY_CONFIRMED', gstAmount: 0, total: 1500 }), 'ACCOUNTANT');
    // The GST TextField (type="number") is prefilled with the real stored value, including zero —
    // never blank/disabled/replaced by a "not set" placeholder.
    expect(inputs().some((i) => i.type === 'number' && i.value === '0')).toBe(true);
  });

  it('drops the Provisional label once FINALIZED — the stored GST is now the actual, settled figure', async () => {
    await renderPage(
      buildInvoice({
        status: 'FINALIZED',
        gstAmount: 75,
        total: 1575,
        finalizedBy: { id: 'u2', name: 'Acc User', email: 'a@test.local' },
        finalizedAt: '2026-09-03T00:00:00.000Z',
      }),
      'ACCOUNTANT',
    );
    expect(content()).not.toContain('Provisional');
    expect(content()).toContain('₹75.00');
  });

  it('shows a legitimate finalized GST of zero to ACCOUNTANT as an actual ₹0.00 figure, not hidden', async () => {
    await renderPage(
      buildInvoice({
        status: 'FINALIZED',
        gstAmount: 0,
        total: 1500,
        finalizedBy: { id: 'u2', name: 'Acc User', email: 'a@test.local' },
        finalizedAt: '2026-09-03T00:00:00.000Z',
      }),
      'ACCOUNTANT',
    );
    expect(content()).not.toContain('Provisional');
    expect(content()).toContain('Subtotal');
    expect(content()).toContain('₹0.00');
  });
});

describe('FactoryInvoiceDetailPage — ISS-010 Style-level financial grouping', () => {
  function multiSizeInvoice(): FactoryInvoiceView {
    return buildInvoice({
      status: 'FINALIZED',
      finalizedBy: { id: 'u2', name: 'Acc User', email: 'a@test.local' },
      finalizedAt: '2026-09-03T00:00:00.000Z',
      subtotal: 3000,
      total: 3000,
      lines: [
        { id: 'line-1', saleOrderLineId: 'sol-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', sizeId: 'size-s', sizeCode: 'S', sizeLabel: 'Small', quantity: 10, defaultRate: 100, unitRate: 100, lineAmount: 1000 },
        { id: 'line-2', saleOrderLineId: 'sol-2', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', sizeId: 'size-m', sizeCode: 'M', sizeLabel: 'Medium', quantity: 20, defaultRate: 100, unitRate: 100, lineAmount: 2000 },
      ],
    });
  }

  it('collapses a Style packed in multiple Sizes into a single financial row with a Size Breakdown and summed Amount', async () => {
    await renderPage(multiSizeInvoice(), 'ACCOUNTANT');
    // Style text appears exactly once as a row label (not once per Size).
    expect(content().match(/ST-001/g)?.length).toBe(1);
    expect(content()).toContain('Small: 10');
    expect(content()).toContain('Medium: 20');
    expect(content()).toContain('₹3,000.00'); // summed line amount for the group
  });

  it('keeps the ungrouped, per-line editable table for ACCOUNTANT while actively editing (FACTORY_CONFIRMED)', async () => {
    const invoice = { ...multiSizeInvoice(), status: 'FACTORY_CONFIRMED' as const, finalizedBy: null, finalizedAt: null };
    await renderPage(invoice, 'ACCOUNTANT');
    // Two separate editable Unit Rate inputs — one per source line — proving grouping is bypassed here.
    expect(inputs().filter((i) => i.value === '100')).toHaveLength(2);
  });
});

function buildFinalizedInvoice(): FactoryInvoiceView {
  return buildInvoice({
    status: 'FINALIZED',
    factoryConfirmedBy: { id: 'u1', name: 'Fac User', email: 'f@test.local' },
    factoryConfirmedAt: '2026-09-02T00:00:00.000Z',
    finalizedBy: { id: 'u2', name: 'Acc User', email: 'a@test.local' },
    finalizedAt: '2026-09-03T00:00:00.000Z',
  });
}

describe('FactoryInvoiceDetailPage — finalized is fully read-only', () => {
  it('shows no Save Changes/Finalize action to ACCOUNTANT once FINALIZED', async () => {
    await renderPage(buildFinalizedInvoice(), 'ACCOUNTANT');
    expect(buttonByText('Save Changes')).toBeNull();
    expect(buttonByText('Finalize')).toBeNull();
    expect(content()).toContain('Acc User');
  });

  it('shows no Confirm action to FACTORY_USER once FINALIZED', async () => {
    await renderPage(buildFinalizedInvoice(), 'FACTORY_USER');
    expect(buttonByText('Confirm Factory Invoice')).toBeNull();
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
