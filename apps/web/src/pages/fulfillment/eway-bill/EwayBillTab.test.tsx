/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type AxiosResponse } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AuthUser,
  EwayBillGenerateResponse,
  EwayBillGenerationPreviewResponse,
  EwayBillHistoryResponse,
  EwayBillMovementRecord,
  EwayBillReadinessResponse,
  Role,
} from '@erve/types';
import { apiClient } from '../../../lib/api-client.js';
import * as Auth from '../../../auth/AuthContext.js';
import { EwayBillTab } from './EwayBillTab.js';
import {
  association,
  attemptFixture,
  billFixture,
  completeMovement,
  historyFixture,
  movementRecord,
  noLinkage,
  previewFixture,
  readinessFixture,
} from './eway-bill-test-fixture.js';

interface Server {
  readiness: EwayBillReadinessResponse;
  movement: EwayBillMovementRecord;
  preview: EwayBillGenerationPreviewResponse;
  history: EwayBillHistoryResponse;
}

let container: HTMLDivElement;
let root: Root;
let server: Server;
let client: QueryClient;
/** Read endpoints (by URL suffix) that currently fail, or never answer. */
let failing: Set<string>;
let hanging: Set<string>;

const fresh = (): Server => ({
  readiness: readinessFixture(),
  movement: movementRecord(completeMovement(), 3),
  preview: previewFixture(),
  history: historyFixture(),
});

beforeEach(() => {
  server = fresh();
  failing = new Set();
  hanging = new Set();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: () => false });
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

const ok = (data: unknown) => ({ data: { success: true, data } });
function axiosFailure(status: number, code: string, message: string, details?: unknown) {
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    data: { success: false, error: { code, message, details } },
  } as AxiosResponse);
}
const networkFailure = () => new AxiosError('timeout of 30000ms exceeded', 'ECONNABORTED');

function mockServerReads() {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    const suffix = ['/generation-preview', '/eway-bill/attempts'].find((item) => url.endsWith(item));
    if (suffix && failing.has(suffix)) throw axiosFailure(503, 'UNAVAILABLE', 'Service unavailable');
    if (suffix && hanging.has(suffix)) return new Promise(() => undefined);
    if (url.endsWith('/eway-bill-readiness')) return ok(server.readiness);
    if (url.endsWith('/eway-bill/movement')) return ok(server.movement);
    if (url.endsWith('/eway-bill/generation-preview')) return ok(server.preview);
    if (url.endsWith('/eway-bill/attempts')) return ok(server.history);
    throw new Error(`Unexpected GET ${url}`);
  });
}
const getCalls = (suffix: string) =>
  vi.mocked(apiClient.get).mock.calls.filter(([url]) => (url as string).endsWith(suffix)).length;

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
}

async function render(
  role: Role = 'ACCOUNTANT',
  invoiceStatus: 'DRAFT' | 'FINALIZED' | 'CANCELLED' = 'FINALIZED',
) {
  const user: AuthUser = { id: 'user-1', email: 'u@test.local', mobile: null, name: 'Test User', roles: [role] };
  vi.spyOn(Auth, 'useAuth').mockReturnValue({
    user,
    token: 't',
    isInitializing: false,
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
  } as unknown as ReturnType<typeof Auth.useAuth>);
  mockServerReads();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <EwayBillTab invoiceId="inv-1" invoiceStatus={invoiceStatus} invoiceNumber="EI/26-27/0001" />
      </QueryClientProvider>,
    );
  });
  await flush();
}

const text = () => document.body.textContent ?? '';
const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
const maybeButton = (label: string) => buttons().find((node) => node.textContent?.trim() === label);
function button(label: string) {
  const found = maybeButton(label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function field(label: string): HTMLElement {
  const node = Array.from(document.querySelectorAll('label')).find(
    (item) => item.textContent?.replace('*', '').trim() === label,
  );
  const target = node && (node.htmlFor ? document.getElementById(node.htmlFor) : null);
  if (!target) throw new Error(`Missing field: ${label}`);
  return target;
}
function typeInto(label: string, value: string) {
  const input = field(label) as HTMLInputElement | HTMLTextAreaElement;
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')!.set!;
  act(() => {
    input.focus();
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.blur();
  });
}
async function choose(label: string, option: string) {
  const trigger = field(label);
  act(() => {
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  });
  await flush();
  const item = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find(
    (node) => node.textContent?.trim() === option,
  );
  if (!item) throw new Error(`Missing option: ${option}`);
  act(() => item.click());
  await flush();
}
async function click(label: string) {
  await act(async () => button(label).click());
  await flush();
}
async function check(label: string) {
  const box = field(label);
  await act(async () => box.click());
}

// ---------------------------------------------------------------------------

describe('Status section', () => {
  it('describes an empty invoice precisely, without implying clearance', async () => {
    await render();
    expect(text()).toContain('E-Way Bill status');
    expect(text()).toContain('EI/26-27/0001');
    expect(text()).toContain('Finalized');
    expect(text()).toContain('Applicable');
    expect(text()).toContain('Ready');
    expect(text()).toContain('Available');
    expect(text()).toContain('No provider-verified E-Way Bill on record');
    expect(text()).not.toMatch(/compliant|clearance obtained/i);
  });

  it('labels a Demo bill as synthetic, and never as verified', async () => {
    server.readiness = readinessFixture({
      linkage: {
        ...noLinkage(),
        syntheticRecords: { activeDemoBills: 1, openDemoAttempts: 0, demoBill: association() },
      },
    });
    server.preview = previewFixture({ linkage: server.readiness.linkage });
    await render();
    expect(text()).toContain('TEST-0001');
    expect(text()).toContain('Demo E-Way Bill — Test only');
    expect(text()).not.toContain('Provider verified');
    expect(text()).not.toMatch(/compliant|clearance obtained/i);
  });

  it('shows a manually linked number as not verified', async () => {
    const linkage = {
      ...noLinkage(),
      state: 'LINKED_UNVERIFIED' as const,
      unverifiedReference: association({
        id: 'bill-2',
        source: 'EXTERNALLY_LINKED',
        integrationMode: 'LIVE',
        ewayBillNumber: '123456789012',
        verificationStatus: 'UNVERIFIED_REFERENCE',
      }),
    };
    server.readiness = readinessFixture({ linkage });
    await render();
    expect(text()).toContain('123456789012');
    expect(text()).toContain('Existing E-Way Bill — Not verified');
    expect(text()).not.toContain('Provider verified');
    expect(text()).toContain('No provider-verified E-Way Bill on record');
  });

  it('reports statutory verification only when the backend does', async () => {
    const linkage = {
      ...noLinkage(),
      state: 'LINKED_EXTERNAL' as const,
      satisfiesStatutoryClearance: true,
      ewayBill: association({
        integrationMode: 'LIVE',
        ewayBillNumber: '123456789012',
        verificationStatus: 'PROVIDER_VERIFIED',
      }),
    };
    server.readiness = readinessFixture({ linkage });
    await render();
    expect(text()).toContain('Provider-verified E-Way Bill on record');
    expect(text()).toContain('Provider verified');
  });

  it('states that applicability is not automatically determined', async () => {
    server.readiness = readinessFixture({
      applicability: { outcome: 'UNDETERMINED', reasons: [{ code: 'NO_RULESET', message: 'No verified rule set is configured.' }], ruleSetVersion: null },
    });
    await render();
    expect(text()).toContain('Applicability not automatically determined');
    expect(text()).toContain('No verified rule set is configured.');
  });

  it('counts unresolved attempts', async () => {
    server.history = historyFixture({ attempts: [attemptFixture()] });
    await render();
    expect(text()).toContain('1 unfinished request');
  });
});

describe('Movement information', () => {
  it('loads saved values and keeps a zero distance', async () => {
    await render();
    expect((field('Vehicle number') as HTMLInputElement).value).toBe('MH12AB1234');
    expect((field('Transporter name') as HTMLInputElement).value).toBe('Fast Movers');
    expect((field('Approximate distance (km)') as HTMLInputElement).value).toBe('0');
    expect(field('Transport mode').textContent).toContain('Road');
    expect(field('Ship-to').textContent).toContain('Billed party');
    expect(field('Dispatch-from').textContent).toContain('Supplier registered premises');
    expect(maybeButton('Save movement information')!.disabled).toBe(true);
  });

  it('saves the complete form with the loaded version, sending cleared fields as null and 0 as 0', async () => {
    const put = vi.spyOn(apiClient, 'put').mockImplementation(async () => ok(movementRecord(completeMovement(), 4)));
    await render();
    typeInto('Transporter name', '');
    typeInto('Vehicle number', 'mh12ab9999');
    expect(maybeButton('Save movement information')!.disabled).toBe(false);
    await click('Save movement information');
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]).toEqual([
      '/tax-invoices/inv-1/eway-bill/movement',
      {
        expectedVersion: 3,
        transportMode: 'ROAD',
        vehicleNumber: 'mh12ab9999',
        vehicleType: 'REGULAR',
        transporterId: null,
        transporterName: null,
        transportDocumentNumber: 'LR-100',
        transportDocumentDate: '2026-11-04',
        approximateDistanceKm: 0,
        shipToArrangement: 'BILLED_PARTY',
        dispatchFromArrangement: 'SUPPLIER_REGISTERED_PREMISES',
        dispatchFrom: null,
      },
    ]);
    expect(text()).toContain('Movement information saved.');
  });

  it('allows a partially completed movement to be saved from an empty record', async () => {
    server.movement = movementRecord();
    server.preview = previewFixture({ movementVersion: null, demo: { integrationMode: 'DEMO', available: false, blockers: [] }, request: { ...previewFixture().request, ready: false, classification: null, document: null } });
    const put = vi.spyOn(apiClient, 'put').mockImplementation(async () => ok(movementRecord(completeMovement(), 1)));
    await render();
    expect(text()).toContain('No movement information saved yet');
    typeInto('Transporter name', 'Fast Movers');
    await click('Save movement information');
    expect(put.mock.calls[0]![1]).toMatchObject({
      expectedVersion: 0,
      transporterName: 'Fast Movers',
      vehicleNumber: null,
      transportMode: null,
      approximateDistanceKm: null,
      dispatchFrom: null,
    });
  });

  it('refuses a distance outside the backend limit instead of saving a stale value', async () => {
    const put = vi.spyOn(apiClient, 'put');
    await render();
    typeInto('Approximate distance (km)', '4001');
    typeInto('Transporter name', 'Changed');
    expect(text()).toContain('Must be at most 4000');
    expect(maybeButton('Save movement information')!.disabled).toBe(true);
    expect(put).not.toHaveBeenCalled();
  });

  it('keeps unsaved edits and offers a reload when the version is stale', async () => {
    const put = vi
      .spyOn(apiClient, 'put')
      .mockRejectedValue(axiosFailure(409, 'STALE_VERSION', 'E-Way Bill movement changed since it was loaded', { currentVersion: 4 }));
    await render();
    typeInto('Transporter name', 'My unsaved edit');
    await click('Save movement information');
    expect(put).toHaveBeenCalledTimes(1);
    expect(text()).toContain('changed by someone else');
    expect((field('Transporter name') as HTMLInputElement).value).toBe('My unsaved edit');

    server.movement = movementRecord({ ...completeMovement(), transporterName: 'Someone else' }, 4);
    await click('Discard my edits and reload');
    expect((field('Transporter name') as HTMLInputElement).value).toBe('Someone else');
    expect(text()).not.toContain('changed by someone else');
  });

  it('shows the server validation message and keeps the form when a save fails', async () => {
    vi.spyOn(apiClient, 'put').mockRejectedValue(
      axiosFailure(400, 'VALIDATION_ERROR', 'Invalid request data', {
        issues: [{ field: 'vehicleNumber', message: 'A vehicle number is 7 to 15 letters or digits' }],
      }),
    );
    await render();
    typeInto('Vehicle number', 'AB1');
    await click('Save movement information');
    expect(text()).toContain('Invalid request data');
    expect(text()).toContain('A vehicle number is 7 to 15 letters or digits');
    expect((field('Vehicle number') as HTMLInputElement).value).toBe('AB1');
    expect(maybeButton('Save movement information')!.disabled).toBe(false);
  });

  it('reveals the dispatch-from address only for a different dispatch location and sends it complete', async () => {
    const put = vi.spyOn(apiClient, 'put').mockImplementation(async () => ok(movementRecord(completeMovement(), 4)));
    await render();
    expect(text()).not.toContain('Dispatch-from address');
    await choose('Dispatch-from', 'Different dispatch location');
    expect(text()).toContain('Dispatch-from address');
    for (const label of ['Address line 1', 'Address line 2', 'City', 'State', 'GST state code', 'PIN code']) {
      expect(field(label)).toBeTruthy();
    }
    typeInto('Address line 1', '12 Depot Road');
    typeInto('City', 'Pune');
    typeInto('State', 'Maharashtra');
    typeInto('GST state code', '27');
    typeInto('PIN code', '411001');
    await click('Save movement information');
    expect(put.mock.calls[0]![1]).toMatchObject({
      dispatchFromArrangement: 'DIFFERENT_PLACE',
      dispatchFrom: {
        addressLine1: '12 Depot Road',
        addressLine2: null,
        city: 'Pune',
        state: 'Maharashtra',
        stateCode: '27',
        postalCode: '411001',
      },
    });
  });

  it('hides the address and sends none when the supplier premises are chosen again', async () => {
    server.movement = movementRecord(
      {
        ...completeMovement(),
        dispatchFromArrangement: 'DIFFERENT_PLACE',
        dispatchFrom: { addressLine1: '12 Depot Road', addressLine2: null, city: 'Pune', state: null, stateCode: '27', postalCode: '411001' },
      },
      3,
    );
    const put = vi.spyOn(apiClient, 'put').mockImplementation(async () => ok(movementRecord(completeMovement(), 4)));
    await render();
    expect((field('Address line 1') as HTMLInputElement).value).toBe('12 Depot Road');
    await choose('Dispatch-from', 'Supplier registered premises');
    expect(text()).not.toContain('Dispatch-from address');
    await click('Save movement information');
    expect(put.mock.calls[0]![1]).toMatchObject({
      dispatchFromArrangement: 'SUPPLIER_REGISTERED_PREMISES',
      dispatchFrom: null,
    });
  });

  it('can clear a select back to not set', async () => {
    const put = vi.spyOn(apiClient, 'put').mockImplementation(async () => ok(movementRecord(completeMovement(), 4)));
    await render();
    await choose('Vehicle type', 'Not set');
    await click('Save movement information');
    expect(put.mock.calls[0]![1]).toMatchObject({ vehicleType: null });
  });

  it('is read-only for ADMIN', async () => {
    await render('ADMIN');
    expect(text()).toContain('View only');
    expect((field('Vehicle number') as HTMLInputElement).disabled).toBe(true);
    expect(maybeButton('Save movement information')).toBeUndefined();
  });

  it('is read-only for a cancelled invoice', async () => {
    await render('ACCOUNTANT', 'CANCELLED');
    expect(text()).toContain('cancelled');
    expect((field('Vehicle number') as HTMLInputElement).disabled).toBe(true);
    expect(maybeButton('Save movement information')).toBeUndefined();
  });

  it('is read-only while a request is unfinished', async () => {
    server.history = historyFixture({ attempts: [attemptFixture()] });
    await render();
    expect(text()).toContain('Resolve it in the attempt history below before changing movement information');
    expect((field('Vehicle number') as HTMLInputElement).disabled).toBe(true);
    expect(maybeButton('Save movement information')).toBeUndefined();
  });
});

describe('Generation preview', () => {
  it('groups blockers by area and keeps generation unavailable', async () => {
    server.preview = previewFixture({
      demo: {
        integrationMode: 'LIVE',
        available: false,
        blockers: [{ source: 'CONFIGURATION', field: 'settings.integrationMode', code: 'DEMO_MODE_REQUIRED', message: 'Demo generation needs Demo mode.' }],
      },
      request: {
        ...previewFixture().request,
        ready: false,
        classification: null,
        document: null,
        blockers: [
          { source: 'INVOICE', field: 'document.snapshot', code: 'LEGACY_SNAPSHOT_MISSING', message: 'This legacy invoice has no issued document snapshot.' },
          { source: 'PARTY', field: 'recipient.gstin', code: 'RECIPIENT_GSTIN_MISSING', message: 'Recipient GSTIN is missing.' },
          { source: 'ITEMS', field: 'items.hsn', code: 'ITEM_HSN_MISSING', message: 'An item has no HSN.', lineIds: ['l1'] },
          { source: 'MOVEMENT', field: 'movement.transportMode', code: 'MOVEMENT_MODE_MISSING', message: 'Transport mode is required.' },
        ],
        warnings: [{ code: 'WARN_1', message: 'Check the vehicle number format.' }],
        assumptions: [{ code: 'ASSUME_1', message: 'The pincode distance rule is not enforced.', basis: 'Unverified' }],
      },
    });
    await render();
    for (const heading of ['Invoice', 'Parties', 'Items', 'Movement', 'Configuration']) {
      expect(Array.from(document.querySelectorAll('h4')).some((node) => node.textContent === heading)).toBe(true);
    }
    expect(text()).toContain('This legacy invoice has no issued document snapshot.');
    expect(text()).toContain('Recipient GSTIN is missing.');
    expect(text()).toContain('Demo generation needs Demo mode.');
    expect(text()).toContain('Check the vehicle number format.');
    expect(text()).toContain('The pincode distance rule is not enforced.');
    expect(text()).toContain('Request blocked');
    expect(button('Generate Demo E-Way Bill').disabled).toBe(true);
  });

  it('shows document identity, item count and classification when ready', async () => {
    await render();
    expect(text()).toContain('Request ready');
    expect(text()).toContain('INV EI/26-27/0001 · 2026-11-04');
    expect(text()).toContain('Regular · Ship-to: Billed party · Dispatch-from: Supplier registered premises');
    expect(text()).toContain('Live (statutory) E-Way Bill generation is not available');
  });

  it('refreshes the preview on request', async () => {
    await render();
    const before = getCalls('/generation-preview');
    await click('Refresh preview');
    expect(getCalls('/generation-preview')).toBe(before + 1);
  });
});

describe('Demo generation availability', () => {
  it('is enabled for an Accountant when every condition holds', async () => {
    await render();
    expect(button('Generate Demo E-Way Bill').disabled).toBe(false);
  });

  it('is not offered to ADMIN', async () => {
    await render('ADMIN');
    expect(maybeButton('Generate Demo E-Way Bill')).toBeUndefined();
    expect(maybeButton('Link Existing E-Way Bill')).toBeUndefined();
    expect(text()).toContain('View only — an Accountant performs E-Way Bill operations.');
  });

  it.each([
    ['the request is not ready', () => previewFixture({ request: { ...previewFixture().request, ready: false } }), 'items above are resolved'],
    ['demo is unavailable', () => previewFixture({ demo: { integrationMode: 'DEMO', available: false, blockers: [{ source: 'CONFIGURATION', field: 'x', code: 'NOT_AUTHORIZED', message: 'Not authorized on this server.' }] } }), 'items above are resolved'],
    ['the invoice is not finalized', () => previewFixture({ invoiceStatus: 'DRAFT' }), 'finalized Tax Invoice'],
    ['no movement version exists', () => previewFixture({ movementVersion: null }), 'items above are resolved'],
    ['a Demo bill already exists', () => previewFixture({ linkage: { ...noLinkage(), syntheticRecords: { activeDemoBills: 1, openDemoAttempts: 0, demoBill: association() } } }), 'already exists'],
    ['a Demo attempt is open', () => previewFixture({ linkage: { ...noLinkage(), syntheticRecords: { activeDemoBills: 0, openDemoAttempts: 1, demoBill: null } } }), 'unfinished'],
  ])('is disabled when %s', async (_name, preview, reason) => {
    server.preview = preview();
    await render();
    expect(button('Generate Demo E-Way Bill').disabled).toBe(true);
    expect(text()).toContain(reason);
  });

  it('is disabled while the history shows an unfinished attempt', async () => {
    server.history = historyFixture({ attempts: [attemptFixture()] });
    await render();
    expect(button('Generate Demo E-Way Bill').disabled).toBe(true);
  });
});

describe('Demo generation flow', () => {
  const succeeded = (): EwayBillGenerateResponse => ({
    outcome: 'SUCCEEDED',
    attempt: attemptFixture({ outcome: 'SUCCEEDED', open: false, requiresReview: false, ewayBillId: 'bill-1', failureCode: null, failureMessage: null }),
    ewayBill: billFixture(),
    alreadyExisted: false,
    failure: null,
  });

  it('confirms the synthetic nature before sending only the movement version', async () => {
    const post = vi.spyOn(apiClient, 'post').mockImplementation(async () => ok(succeeded()));
    await render();
    await click('Generate Demo E-Way Bill');
    expect(post).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('GSTINAPI Demo');
    expect(dialog.textContent).toContain('synthetic');
    expect(dialog.textContent).toContain('no statutory validity');
    expect(dialog.textContent).toContain('not a government filing');
    expect(dialog.textContent).not.toContain('applicability has not been automatically determined');

    await click('Cancel');
    expect(post).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await click('Generate Demo E-Way Bill');
    await click('Confirm Demo generation');
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]).toEqual(['/tax-invoices/inv-1/eway-bill/generate', { expectedMovementVersion: 3 }]);
  });

  it('requires an explicit acknowledgement while applicability is undetermined', async () => {
    server.preview = previewFixture({
      acknowledgementRequired: true,
      applicability: { outcome: 'UNDETERMINED', reasons: [], ruleSetVersion: null },
    });
    const post = vi.spyOn(apiClient, 'post').mockImplementation(async () => ok(succeeded()));
    await render();
    await click('Generate Demo E-Way Bill');
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('has not been automatically determined');
    expect(button('Confirm Demo generation').disabled).toBe(true);
    await check('Applicability has not been automatically determined, and I have determined it myself.');
    expect(button('Confirm Demo generation').disabled).toBe(false);
    await click('Confirm Demo generation');
    expect(post.mock.calls[0]![1]).toEqual({ expectedMovementVersion: 3, acknowledgeApplicabilityUndetermined: true });
  });

  it('shows a prominent synthetic label on success, never a compliance claim, and refreshes server state', async () => {
    vi.spyOn(apiClient, 'post').mockImplementation(async () => {
      server.preview = previewFixture({ linkage: { ...noLinkage(), syntheticRecords: { activeDemoBills: 1, openDemoAttempts: 0, demoBill: association() } } });
      server.history = historyFixture({ attempts: [succeeded().attempt], ewayBills: [billFixture()] });
      return ok(succeeded());
    });
    await render();
    const previewReads = getCalls('/generation-preview');
    await click('Generate Demo E-Way Bill');
    await click('Confirm Demo generation');
    expect(text()).toContain('Demo E-Way Bill — Test only');
    expect(text()).toContain('TEST-0001');
    expect(text()).toContain('no statutory validity');
    expect(text()).not.toMatch(/compliant|clearance obtained|Provider verified/i);
    expect(getCalls('/generation-preview')).toBeGreaterThan(previewReads);
    expect(button('Generate Demo E-Way Bill').disabled).toBe(true);
  });

  it('shows the normalized rejection and offers another attempt only after state is refreshed', async () => {
    const rejected: EwayBillGenerateResponse = {
      outcome: 'REJECTED',
      attempt: attemptFixture({ outcome: 'REJECTED', open: false, requiresReview: false }),
      ewayBill: null,
      alreadyExisted: false,
      failure: { code: 'INVALID_REQUEST', message: 'The provider rejected the request as invalid.' },
    };
    const post = vi.spyOn(apiClient, 'post').mockImplementation(async () => {
      server.history = historyFixture({ attempts: [rejected.attempt] });
      return ok(rejected);
    });
    await render();
    await click('Generate Demo E-Way Bill');
    await click('Confirm Demo generation');
    expect(text()).toContain('Rejected by provider');
    expect(text()).toContain('The provider rejected the request as invalid.');
    expect(text()).toContain('INVALID_REQUEST');
    expect(post).toHaveBeenCalledTimes(1);
    expect(button('Generate Demo E-Way Bill').disabled).toBe(false);
    expect(getCalls('/eway-bill/attempts')).toBeGreaterThan(1);
  });

  it('warns that an uncertain outcome is unknown, does not retry, and blocks another attempt', async () => {
    const uncertain: EwayBillGenerateResponse = {
      outcome: 'UNCERTAIN',
      attempt: attemptFixture(),
      ewayBill: null,
      alreadyExisted: false,
      failure: { code: 'TIMEOUT', message: 'The provider did not answer in time. The outcome is unknown.' },
    };
    const post = vi.spyOn(apiClient, 'post').mockImplementation(async () => {
      server.history = historyFixture({ attempts: [uncertain.attempt] });
      server.preview = previewFixture({ linkage: { ...noLinkage(), syntheticRecords: { activeDemoBills: 0, openDemoAttempts: 1, demoBill: null } } });
      return { status: 202, data: { success: true, data: uncertain } };
    });
    await render();
    await click('Generate Demo E-Way Bill');
    await click('Confirm Demo generation');
    const alerts = Array.from(document.querySelectorAll('[role="alert"]')).map((node) => node.textContent);
    expect(alerts.some((value) => value?.includes('Generation outcome unknown'))).toBe(true);
    expect(text()).toContain('Do not retry');
    expect(post).toHaveBeenCalledTimes(1);
    expect(button('Generate Demo E-Way Bill').disabled).toBe(true);
    expect(text()).toContain('Close Demo Attempt');
  });

  it('does not assume a network failure was a rejection, does not retry, and reloads state', async () => {
    const post = vi.spyOn(apiClient, 'post').mockImplementation(async () => {
      server.history = historyFixture({ attempts: [attemptFixture({ outcome: 'DISPATCHED', requiresReview: false })] });
      throw networkFailure();
    });
    await render();
    const historyReads = getCalls('/eway-bill/attempts');
    await click('Generate Demo E-Way Bill');
    await click('Confirm Demo generation');
    expect(text()).toContain('Request status unknown');
    expect(text()).toContain('may have reached the provider');
    expect(text()).not.toContain('Rejected by provider');
    expect(post).toHaveBeenCalledTimes(1);
    expect(getCalls('/eway-bill/attempts')).toBeGreaterThan(historyReads);
    expect(button('Generate Demo E-Way Bill').disabled).toBe(true);
  });

  it('treats a 5xx response as an unknown outcome too', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(axiosFailure(502, 'EWAY_BILL_OUTCOME_UNRECORDED', 'The request attempt could not be read back'));
    await render();
    await click('Generate Demo E-Way Bill');
    await click('Confirm Demo generation');
    expect(text()).toContain('Request status unknown');
  });

  it('shows a definite refusal as not started', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(
      axiosFailure(409, 'CONFLICT', 'Demo E-Way Bill generation is not permitted right now'),
    );
    await render();
    await click('Generate Demo E-Way Bill');
    await click('Confirm Demo generation');
    expect(text()).toContain('Demo generation was not started');
    expect(text()).toContain('not permitted right now');
    expect(text()).not.toContain('Request status unknown');
  });

  it('explains a stale preview', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(axiosFailure(409, 'STALE_VERSION', 'stale', { currentVersion: 4 }));
    await render();
    await click('Generate Demo E-Way Bill');
    await click('Confirm Demo generation');
    expect(text()).toContain('changed after this preview was loaded');
  });

  it('sends one request even if confirmation is activated repeatedly while pending', async () => {
    let finish!: (value: unknown) => void;
    const post = vi.spyOn(apiClient, 'post').mockImplementation(
      () => new Promise((resolve) => { finish = resolve; }),
    );
    await render();
    await click('Generate Demo E-Way Bill');
    const confirm = button('Confirm Demo generation');
    await act(async () => { confirm.click(); confirm.click(); confirm.click(); });
    expect(post).toHaveBeenCalledTimes(1);
    expect(button('Generate Demo E-Way Bill').disabled).toBe(true);
    await act(async () => finish(ok(succeeded())));
    await flush();
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe('Linking an existing E-Way Bill', () => {
  it('records the number as an unverified reference after explicit confirmation', async () => {
    const linked = billFixture({ id: 'bill-2', source: 'EXTERNALLY_LINKED', integrationMode: 'LIVE', verificationStatus: 'UNVERIFIED_REFERENCE', ewayBillNumber: '123456789012' });
    const post = vi.spyOn(apiClient, 'post').mockImplementation(async () => {
      server.readiness = readinessFixture({
        linkage: { ...noLinkage(), state: 'LINKED_UNVERIFIED', unverifiedReference: association({ id: 'bill-2', source: 'EXTERNALLY_LINKED', integrationMode: 'LIVE', ewayBillNumber: '123456789012', verificationStatus: 'UNVERIFIED_REFERENCE' }) },
      });
      server.history = historyFixture({ ewayBills: [linked] });
      return ok({ ewayBill: linked });
    });
    await render();
    await click('Link Existing E-Way Bill');
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('generated outside ERVE India');
    expect(dialog.textContent).toContain('has not verified this number');
    expect(dialog.textContent).toContain('unverified reference');
    expect(dialog.textContent).toContain('not statutory clearance');
    expect(dialog.textContent).toContain('cannot be edited or removed');

    const submit = button('Link as unverified reference');
    expect(submit.disabled).toBe(true);
    typeInto('E-Way Bill number', '12345');
    expect(text()).toContain('exactly 12 digits');
    expect(button('Link as unverified reference').disabled).toBe(true);
    typeInto('E-Way Bill number', '123456789012');
    expect(button('Link as unverified reference').disabled).toBe(true); // not yet confirmed
    await check('I have checked this number. It was generated outside ERVE India and is not verified here.');
    expect(button('Link as unverified reference').disabled).toBe(false);
    await click('Link as unverified reference');

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]).toEqual(['/tax-invoices/inv-1/eway-bill/link', { ewayBillNumber: '123456789012' }]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(text()).toContain('Linked as an unverified reference');
    expect(text()).toContain('Existing E-Way Bill — Not verified');
    expect(text()).not.toContain('Provider verified');
    expect(maybeButton('Link Existing E-Way Bill')!.disabled).toBe(true);
  });

  it('shows the backend refusal and keeps the dialog open', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(axiosFailure(409, 'CONFLICT', 'This E-Way Bill number is already recorded'));
    await render();
    await click('Link Existing E-Way Bill');
    typeInto('E-Way Bill number', '123456789012');
    await check('I have checked this number. It was generated outside ERVE India and is not verified here.');
    await click('Link as unverified reference');
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('already recorded');
  });

  it('is not offered on a draft invoice', async () => {
    server.preview = previewFixture({ invoiceStatus: 'DRAFT' });
    await render('ACCOUNTANT', 'DRAFT');
    expect(maybeButton('Link Existing E-Way Bill')!.disabled).toBe(true);
    expect(text()).toContain('only to a finalized Tax Invoice');
  });
});

describe('Attempt history and Demo closure', () => {
  const closed = () =>
    attemptFixture({
      id: 'attempt-0',
      outcome: 'CLOSED',
      open: false,
      requiresReview: false,
      reviewAfter: null,
      completedAt: '2026-11-04T08:00:00.000Z',
      resolution: { by: { id: 'acct-2', name: 'Accountant Two' }, at: '2026-11-04T08:00:00.000Z', reason: 'Provider console showed nothing' },
    });

  it('lists attempts with outcome, mode, actor, failure, review, resolution, bill and audit events', async () => {
    server.history = historyFixture({
      attempts: [
        attemptFixture(),
        closed(),
        attemptFixture({ id: 'attempt-ok', outcome: 'SUCCEEDED', open: false, requiresReview: false, failureCode: null, failureMessage: null, ewayBillId: 'bill-1', reviewAfter: null }),
      ],
      ewayBills: [billFixture()],
      events: [
        { id: 'e1', action: 'EWAY_BILL_DEMO_ATTEMPT_CLOSED', createdAt: '2026-11-04T08:00:00.000Z', actor: { id: 'acct-2', name: 'Accountant Two' }, metadata: { reason: 'Provider console showed nothing' } },
        { id: 'e2', action: 'EWAY_BILL_MOVEMENT_UPDATED', createdAt: '2026-11-04T05:00:00.000Z', actor: { id: 'acct-1', name: 'Accountant One' }, metadata: { changes: { vehicleNumber: {} } } },
      ],
    });
    await render();
    expect(text()).toContain('Generation outcome unknown');
    expect(text()).toContain('Demo attempt manually closed');
    expect(text()).toContain('Demo E-Way Bill recorded');
    expect(text()).toContain('The provider did not answer in time');
    expect(text()).toContain('TIMEOUT');
    expect(text()).toContain('Needs review by a person');
    expect(text()).toContain('Closed by Accountant Two');
    expect(text()).toContain('Provider console showed nothing');
    expect(text()).toContain('Associated E-Way Bill:');
    expect(text()).toContain('Demo attempt manually closed'); // audit title
    expect(text()).toContain('Movement information updated');
    expect(text()).toContain('Changed: vehicleNumber');
    expect(text()).toContain('DEMO');
  });

  it('shows an empty state', async () => {
    await render();
    expect(text()).toContain('No generation attempts yet.');
    expect(text()).toContain('No E-Way Bill is recorded for this invoice.');
  });

  it('requires a reason of at least 10 characters and the observed outcome to close a Demo attempt', async () => {
    server.history = historyFixture({ attempts: [attemptFixture()] });
    const post = vi.spyOn(apiClient, 'post').mockImplementation(async () => {
      server.history = historyFixture({ attempts: [attemptFixture({ outcome: 'CLOSED', open: false, requiresReview: false })] });
      return ok({ attempt: server.history.attempts[0] });
    });
    await render();
    await click('Close Demo Attempt');
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('administrative recovery action');
    expect(dialog.textContent).toContain('does not prove whether the provider');
    expect(button('Confirm closure').disabled).toBe(true);
    typeInto('Reason', 'too short');
    expect(button('Confirm closure').disabled).toBe(true);
    typeInto('Reason', 'Provider dashboard shows no such request');
    expect(button('Confirm closure').disabled).toBe(false);
    await click('Confirm closure');
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]).toEqual([
      '/tax-invoices/inv-1/eway-bill/attempts/attempt-1/close-demo',
      { expectedOutcome: 'UNCERTAIN', reason: 'Provider dashboard shows no such request' },
    ]);
    expect(text()).toContain('Demo attempt closed. Nothing was retried.');
    // Closing never starts another request.
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog open with the backend message when closure is refused', async () => {
    server.history = historyFixture({ attempts: [attemptFixture()] });
    vi.spyOn(apiClient, 'post').mockRejectedValue(axiosFailure(409, 'CONFLICT', 'The attempt changed since it was loaded'));
    await render();
    await click('Close Demo Attempt');
    typeInto('Reason', 'Provider dashboard shows no such request');
    await click('Confirm closure');
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('The attempt changed since it was loaded');
  });

  it('does not allow closure before the review time has passed', async () => {
    server.history = historyFixture({ attempts: [attemptFixture({ outcome: 'DISPATCHED', requiresReview: false, failureCode: null, failureMessage: null })] });
    await render();
    expect(button('Close Demo Attempt').disabled).toBe(true);
    expect(text()).toContain('May still be in progress');
    expect(text()).toContain('Available once the review time has passed');
  });

  it('never offers closure for a Live attempt or to ADMIN', async () => {
    server.history = historyFixture({ attempts: [attemptFixture({ integrationMode: 'LIVE' })] });
    await render();
    expect(maybeButton('Close Demo Attempt')).toBeUndefined();

    act(() => root.unmount());
    root = createRoot(container);
    server.history = historyFixture({ attempts: [attemptFixture()] });
    await render('ADMIN');
    expect(maybeButton('Close Demo Attempt')).toBeUndefined();
  });
});

describe('Fail-closed status handling', () => {
  const PREVIEW = '/generation-preview';
  const HISTORY = '/eway-bill/attempts';
  const uncertain = (): EwayBillGenerateResponse => ({
    outcome: 'UNCERTAIN',
    attempt: attemptFixture(),
    ewayBill: null,
    alreadyExisted: false,
    failure: { code: 'TIMEOUT', message: 'The provider did not answer in time. The outcome is unknown.' },
  });
  const generateButton = () => button('Generate Demo E-Way Bill');
  async function startGeneration() {
    await click('Generate Demo E-Way Bill');
    await click('Confirm Demo generation');
  }

  it('keeps generation disabled after a network failure when the refresh also fails, then reconciles on a successful refresh', async () => {
    const post = vi.spyOn(apiClient, 'post').mockImplementation(async () => {
      failing.add(PREVIEW);
      failing.add(HISTORY);
      throw networkFailure();
    });
    await render();
    await startGeneration();
    // The cached preview still says "ready" and the cached history says nothing is open.
    expect(text()).toContain('Request ready');
    expect(generateButton().disabled).toBe(true);
    expect(text()).toContain('Latest status could not be confirmed');
    expect(text()).toContain('Request status unknown');
    expect(text()).toContain('has not been confirmed yet');
    expect((field('Vehicle number') as HTMLInputElement).disabled).toBe(true);

    await click('Refresh status'); // the reads still fail
    expect(generateButton().disabled).toBe(true);
    expect(text()).toContain('Request status unknown');

    failing.clear();
    await click('Refresh status');
    expect(generateButton().disabled).toBe(false);
    expect(text()).not.toContain('Latest status could not be confirmed');
    expect(text()).toContain('Request status unknown'); // never silently dismissed
    expect(text()).toContain('The attempt history and preview have been reloaded');
    expect(post).toHaveBeenCalledTimes(1); // nothing retried automatically
  });

  it('stays disabled after an HTTP 202 UNCERTAIN result when the refresh fails, and follows the backend once it succeeds', async () => {
    const post = vi.spyOn(apiClient, 'post').mockImplementation(async () => {
      failing.add(PREVIEW);
      failing.add(HISTORY);
      return { status: 202, data: { success: true, data: uncertain() } };
    });
    await render();
    await startGeneration();
    expect(generateButton().disabled).toBe(true);
    expect(text()).toContain('Generation outcome unknown');
    expect(text()).toContain('Latest status could not be confirmed');

    failing.clear();
    server.history = historyFixture({ attempts: [attemptFixture()] });
    server.preview = previewFixture({
      linkage: { ...noLinkage(), syntheticRecords: { activeDemoBills: 0, openDemoAttempts: 1, demoBill: null } },
    });
    await click('Refresh status');
    expect(generateButton().disabled).toBe(true); // the backend reports an open attempt
    expect(text()).toContain('Generation outcome unknown');
    expect(text()).toContain('Close Demo Attempt');
    expect(text()).not.toContain('Latest status could not be confirmed');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('does not let a fresh preview alone re-enable generation', async () => {
    vi.spyOn(apiClient, 'post').mockImplementation(async () => {
      failing.add(HISTORY);
      return { status: 202, data: { success: true, data: uncertain() } };
    });
    await render();
    await startGeneration();
    expect(server.preview.demo.available).toBe(true);
    expect(generateButton().disabled).toBe(true);
    expect(text()).toContain('Latest status could not be confirmed');
  });

  it('does not let a fresh history alone re-enable generation', async () => {
    vi.spyOn(apiClient, 'post').mockImplementation(async () => {
      failing.add(PREVIEW);
      throw networkFailure();
    });
    await render();
    await startGeneration();
    expect(generateButton().disabled).toBe(true);
  });

  it('stays disabled while a refresh has not answered', async () => {
    vi.spyOn(apiClient, 'post').mockImplementation(async () => {
      hanging.add(PREVIEW);
      hanging.add(HISTORY);
      throw networkFailure();
    });
    await render();
    await startGeneration();
    expect(generateButton().disabled).toBe(true);
    expect(text()).toContain('Refreshing the E-Way Bill request history');
  });

  it('stays blocked after a refresh that reports an active Demo bill', async () => {
    vi.spyOn(apiClient, 'post').mockImplementation(async () => {
      failing.add(PREVIEW);
      failing.add(HISTORY);
      throw networkFailure();
    });
    await render();
    await startGeneration();
    failing.clear();
    server.preview = previewFixture({
      linkage: { ...noLinkage(), syntheticRecords: { activeDemoBills: 1, openDemoAttempts: 0, demoBill: association() } },
    });
    server.history = historyFixture({
      attempts: [attemptFixture({ outcome: 'SUCCEEDED', open: false, requiresReview: false, ewayBillId: 'bill-1' })],
      ewayBills: [billFixture()],
    });
    await click('Refresh status');
    expect(generateButton().disabled).toBe(true);
    expect(text()).toContain('A Demo E-Way Bill already exists');
  });

  it('prevents movement edits and generation when the history cannot be loaded, and recovers on retry', async () => {
    failing.add(HISTORY);
    await render();
    expect((field('Vehicle number') as HTMLInputElement).disabled).toBe(true);
    expect(maybeButton('Save movement information')).toBeUndefined();
    expect(text()).toContain('request history could not be verified');
    expect(generateButton().disabled).toBe(true);
    expect(text()).toContain('Latest status could not be confirmed');

    failing.clear();
    await click('Retry loading status');
    expect((field('Vehicle number') as HTMLInputElement).disabled).toBe(false);
    expect(generateButton().disabled).toBe(false);
  });

  it('keeps unsaved movement edits when the history later becomes unverified', async () => {
    await render();
    typeInto('Transporter name', 'My unsaved edit');
    failing.add(HISTORY);
    await act(async () => {
      await client.refetchQueries({ queryKey: ['eway-bill', 'inv-1', 'history'] });
    });
    await flush();
    const input = field('Transporter name') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.value).toBe('My unsaved edit');
    expect(maybeButton('Save movement information')).toBeUndefined();

    failing.clear();
    await click('Retry loading status');
    const restored = field('Transporter name') as HTMLInputElement;
    expect(restored.disabled).toBe(false);
    expect(restored.value).toBe('My unsaved edit');
    expect(maybeButton('Save movement information')!.disabled).toBe(false);
  });

  it('does not infer "no open attempts" while the history is still loading', async () => {
    hanging.add(HISTORY);
    await render();
    expect((field('Vehicle number') as HTMLInputElement).disabled).toBe(true);
    expect(text()).toContain('Checking for unfinished E-Way Bill requests');
    expect(generateButton().disabled).toBe(true);
  });

  it('still allows another attempt after a definite rejection once the refresh succeeds', async () => {
    const rejected: EwayBillGenerateResponse = {
      outcome: 'REJECTED',
      attempt: attemptFixture({ outcome: 'REJECTED', open: false, requiresReview: false }),
      ewayBill: null,
      alreadyExisted: false,
      failure: { code: 'INVALID_REQUEST', message: 'The provider rejected the request as invalid.' },
    };
    vi.spyOn(apiClient, 'post').mockImplementation(async () => ok(rejected));
    await render();
    await startGeneration();
    expect(text()).toContain('Rejected by provider');
    expect(generateButton().disabled).toBe(false);
  });
});
