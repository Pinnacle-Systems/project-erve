/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { SellerRegistrationFormPage } from './SellerRegistrationFormPage.js';
import type { SellerRegistration } from './types.js';

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
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
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

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function cssEscapeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

function findInput(label: string): HTMLInputElement {
  const clean = label.replace(/\s*\*$/, '');
  const labelEl = Array.from(container.querySelectorAll('label')).find(
    (el) => el.textContent?.replace(/\s*\*$/, '') === clean,
  );
  if (!labelEl) throw new Error(`Label "${label}" not found`);
  const forId = labelEl.getAttribute('for');
  const control = forId ? container.querySelector<HTMLInputElement>(`#${cssEscapeId(forId)}`) : null;
  if (!control) throw new Error(`Control for label "${label}" not found`);
  return control;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return;
    await act(async () => {
      await flushMicrotasks();
    });
  }
  throw new Error(message);
}

function makeSellerRegistration(overrides: Partial<SellerRegistration> = {}): SellerRegistration {
  return {
    id: 'seller-1',
    branchCode: 'ERVE-HO',
    legalName: 'ERVE Apparel Private Limited',
    tradeName: 'ERVE',
    gstin: '27AAAAA0000A1Z5',
    city: 'Mumbai',
    state: 'Maharashtra',
    status: 'ACTIVE',
    einvoiceApplicable: false,
    addressLine1: '1 Industrial Estate',
    addressLine2: null,
    district: null,
    stateCode: '27',
    postalCode: '400001',
    country: 'India',
    bankName: 'HDFC Bank',
    bankAccountName: 'ERVE Apparel Private Limited',
    bankAccountNumber: '000111222333',
    bankIfsc: 'HDFC0001234',
    bankBranchName: 'Andheri',
    bankAddress: null,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  };
}

function mockGets(overrides: Record<string, () => Promise<unknown>> = {}) {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    const handler = overrides[url];
    if (handler) return handler();
    throw new Error(`Unexpected request: ${url}`);
  });
}

function renderFormPage(path: string, routePath: string) {
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={routePath} element={<SellerRegistrationFormPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}

function fillValidForm() {
  setInputValue(findInput('Legal Name *'), 'ERVE Apparel Private Limited');
  setInputValue(findInput('Branch Code *'), 'ERVE-HO');
  setInputValue(findInput('GSTIN *'), '27aaaaa0000a1z5');
  setInputValue(findInput('State *'), 'Maharashtra');
  setInputValue(findInput('State Code *'), '27');
  setInputValue(findInput('PIN *'), '400001');
  setInputValue(findInput('Address Line 1 *'), '1 Industrial Estate');
  setInputValue(findInput('City *'), 'Mumbai');
  setInputValue(findInput('Bank Name *'), 'HDFC Bank');
  setInputValue(findInput('Beneficiary / Account Name *'), 'ERVE Apparel Private Limited');
  setInputValue(findInput('Account Number *'), '000111222333');
  setInputValue(findInput('IFSC *'), 'hdfc0001234');
  setInputValue(findInput('Branch Name *'), 'Andheri');
}

async function submit() {
  const form = container.querySelector('form') as HTMLFormElement;
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushMicrotasks();
  });
}

describe('SellerRegistrationFormPage — sections', () => {
  it('CREATE: groups fields into Seller Identity, GST Registration, Registered Address and Bank Details', async () => {
    mockGets();
    renderFormPage('/master-data/seller-registrations/new', '/master-data/seller-registrations/new');
    await act(async () => {
      await flushMicrotasks();
    });

    const sectionTitles = Array.from(container.querySelectorAll('h4')).map((h) => h.textContent);
    expect(sectionTitles).toEqual([
      'Seller Identity',
      'GST Registration',
      'Registered Address',
      'Bank Details',
    ]);
  });
});

describe('SellerRegistrationFormPage — validation', () => {
  it('CREATE: rejects an invalid GSTIN and does not call the API', async () => {
    const postSpy = vi.spyOn(apiClient, 'post');
    mockGets();
    renderFormPage('/master-data/seller-registrations/new', '/master-data/seller-registrations/new');
    await act(async () => {
      await flushMicrotasks();
    });

    act(() => fillValidForm());
    act(() => setInputValue(findInput('GSTIN *'), 'NOT-A-GSTIN'));
    await submit();

    expect(container.textContent).toContain('Enter a valid 15-character GSTIN');
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('CREATE: rejects a GSTIN/state-code mismatch', async () => {
    const postSpy = vi.spyOn(apiClient, 'post');
    mockGets();
    renderFormPage('/master-data/seller-registrations/new', '/master-data/seller-registrations/new');
    await act(async () => {
      await flushMicrotasks();
    });

    act(() => fillValidForm());
    act(() => setInputValue(findInput('State Code *'), '09'));
    await submit();

    expect(container.textContent).toContain('GST state code must match');
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('CREATE: rejects a malformed PIN code', async () => {
    const postSpy = vi.spyOn(apiClient, 'post');
    mockGets();
    renderFormPage('/master-data/seller-registrations/new', '/master-data/seller-registrations/new');
    await act(async () => {
      await flushMicrotasks();
    });

    act(() => fillValidForm());
    act(() => setInputValue(findInput('PIN *'), '12345'));
    await submit();

    expect(container.textContent).toContain('Enter a valid 6-digit PIN code');
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('CREATE: rejects a malformed IFSC code', async () => {
    const postSpy = vi.spyOn(apiClient, 'post');
    mockGets();
    renderFormPage('/master-data/seller-registrations/new', '/master-data/seller-registrations/new');
    await act(async () => {
      await flushMicrotasks();
    });

    act(() => fillValidForm());
    act(() => setInputValue(findInput('IFSC *'), 'INVALID'));
    await submit();

    expect(container.textContent).toContain('Enter a valid 11-character IFSC');
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('CREATE: submits successfully with normalized GSTIN/IFSC, preserving code-like fields as text', async () => {
    const created = makeSellerRegistration({ id: 'seller-new' });
    mockGets();
    vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: created } });
    renderFormPage('/master-data/seller-registrations/new', '/master-data/seller-registrations/new');
    await act(async () => {
      await flushMicrotasks();
    });

    act(() => fillValidForm());
    await submit();

    expect(apiClient.post).toHaveBeenCalledWith(
      '/seller-registrations',
      expect.objectContaining({
        gstin: '27AAAAA0000A1Z5',
        bankIfsc: 'HDFC0001234',
        // Code-like fields stay strings — leading zeroes/exact formatting
        // must survive untouched, never coerced to a number.
        branchCode: 'ERVE-HO',
        postalCode: '400001',
        bankAccountNumber: '000111222333',
        stateCode: '27',
      }),
    );
  });
});

describe('SellerRegistrationFormPage — edit hydration', () => {
  it('EDIT: hydrates every field from the server record', async () => {
    const registration = makeSellerRegistration({ legalName: 'Server Hydrated Seller Pvt Ltd' });
    mockGets({
      '/seller-registrations/seller-1': () => Promise.resolve({ data: { data: registration } }),
    });
    renderFormPage(
      '/master-data/seller-registrations/seller-1/edit',
      '/master-data/seller-registrations/:id/edit',
    );

    await waitFor(
      () => !container.textContent?.includes('Loading seller registration'),
      'timed out waiting for loading to clear',
    );

    expect(findInput('Legal Name *').value).toBe('Server Hydrated Seller Pvt Ltd');
    expect(findInput('Branch Code *').value).toBe('ERVE-HO');
    expect(findInput('Account Number *').value).toBe('000111222333');
  });

  it('EDIT: submits a PATCH with the updated fields', async () => {
    const registration = makeSellerRegistration();
    let patchBody: unknown;
    mockGets({
      '/seller-registrations/seller-1': () => Promise.resolve({ data: { data: registration } }),
    });
    vi.spyOn(apiClient, 'patch').mockImplementation(async (_url: string, body: unknown) => {
      patchBody = body;
      return { data: { data: registration } };
    });
    renderFormPage(
      '/master-data/seller-registrations/seller-1/edit',
      '/master-data/seller-registrations/:id/edit',
    );
    await waitFor(
      () => !container.textContent?.includes('Loading seller registration'),
      'timed out waiting for loading to clear',
    );

    act(() => setInputValue(findInput('Legal Name *'), 'Renamed Seller Pvt Ltd'));
    await submit();

    expect(patchBody).toMatchObject({ legalName: 'Renamed Seller Pvt Ltd' });
  });
});
