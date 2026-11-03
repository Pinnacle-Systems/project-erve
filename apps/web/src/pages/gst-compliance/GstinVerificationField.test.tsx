/** @vitest-environment jsdom */
import { useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GstVerificationEvidence, GstVerificationView } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import {
  GstinVerificationField,
  GstinVerificationInline,
  type GstinVerificationFieldProps,
} from './GstinVerificationField.js';

const GSTIN = '33AAAAA0000A1Z5';
const OTHER = '29BBBBB1111B1Z6';
const evidence = (overrides: Partial<GstVerificationEvidence> = {}): GstVerificationEvidence => ({
  id: 'e1',
  requestedGstin: GSTIN,
  normalizedGstin: GSTIN,
  lookupGstin: GSTIN,
  returnedGstin: GSTIN,
  mode: 'LIVE',
  level: 'COMPLETE',
  governmentStatus: 'ACTIVE',
  legalName: 'Synthetic Traders Pvt Ltd',
  tradeName: 'Synthetic Traders',
  taxpayerType: 'Regular',
  registrationDate: '2019-04-01',
  registeredAddress: '12 Test Street, Tiruppur',
  businessConstitution: 'Private Limited Company',
  filingFrequency: 'Monthly',
  gstr1FiledTill: '2099-01',
  gstr3bFiledTill: '2099-01',
  partial: false,
  unavailable: [],
  retrievedAt: '2026-11-02T06:00:00Z',
  expiresAt: '2099-01-01T00:00:00Z',
  ttlSeconds: 604800,
  estimatedCredits: 2,
  actualCredits: null,
  billingCategory: null,
  ...overrides,
});
const view = (overrides: Partial<GstVerificationView> = {}): GstVerificationView => ({
  enabled: true,
  mode: 'LIVE',
  level: 'COMPLETE',
  canVerify: true,
  canRefresh: false,
  cacheState: 'NONE',
  evidence: null,
  latestFailure: null,
  ...overrides,
});
const freshLive = () => view({ cacheState: 'FRESH', evidence: evidence() });

let container: HTMLDivElement;
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

type Policy = { enabled: boolean; mode?: 'DEMO' | 'LIVE'; level?: 'BASIC' | 'COMPLETE' };
/** Routes GET /policy and GET /verification; everything else rejects. */
function mockGets(policy: Policy, read: (params: Record<string, string>) => GstVerificationView | Error) {
  return vi.spyOn(apiClient, 'get').mockImplementation(async (url, config) => {
    if (url.endsWith('/policy')) return { data: { data: policy } };
    const result = read((config?.params ?? {}) as Record<string, string>);
    if (result instanceof Error) throw result;
    return { data: { data: result } };
  });
}
const verificationGets = (get: ReturnType<typeof mockGets>) =>
  get.mock.calls.filter(([url]) => !String(url).endsWith('/policy'));
const apiError = (message: string, status = 503) =>
  Object.assign(new Error('Request failed'), {
    isAxiosError: true,
    response: { status, data: { error: { message } } },
  });

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
function Harness({ initial, ...props }: { initial: string } & Partial<GstinVerificationFieldProps>) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <GstinVerificationField
        label="GSTIN"
        entity="DISTRIBUTOR"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        {...props}
      />
      <button type="button" onClick={() => setValue(OTHER)}>
        change-gstin
      </button>
    </>
  );
}
async function render(node: React.ReactNode) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        {node}
      </QueryClientProvider>,
    ),
  );
  await settle();
}
const input = () => container.querySelector('input') as HTMLInputElement;
const buttonByLabel = (label: RegExp | string) =>
  [...document.querySelectorAll('button')].find((b) =>
    typeof label === 'string'
      ? b.getAttribute('aria-label') === label || b.textContent === label
      : label.test(b.getAttribute('aria-label') ?? b.textContent ?? ''),
  );
async function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}
async function click(el: Element | undefined) {
  await act(async () => (el as HTMLElement).click());
  await settle();
}

describe('GstinVerificationField — online verification disabled', () => {
  it('behaves as the plain TextField: no verification requests, actions, badges or format nagging', async () => {
    const get = mockGets({ enabled: false }, () => freshLive());
    const post = vi.spyOn(apiClient, 'post');
    await render(<Harness initial="not-a-gstin" required />);
    expect(container.querySelector('label')!.textContent).toContain('GSTIN');
    expect(container.querySelector('label')!.textContent).toContain('*');
    expect(input().value).toBe('not-a-gstin');
    await type(GSTIN);
    expect(input().value).toBe(GSTIN);
    input().dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(container.querySelectorAll('button')).toHaveLength(1); // only the harness's own button
    expect(container.textContent).not.toMatch(/Verify|verified|Demo Sample|valid 15-character/);
    expect(verificationGets(get)).toHaveLength(0);
    expect(post).not.toHaveBeenCalled();
  });
  it('still shows the parent form validation message', async () => {
    mockGets({ enabled: false }, () => freshLive());
    await render(<Harness initial="" errorMessage="Required" />);
    expect(container.textContent).toContain('Required');
    expect(input().getAttribute('aria-invalid')).toBe('true');
  });
  it('falls back to a plain field when the policy cannot be read', async () => {
    const get = vi.spyOn(apiClient, 'get').mockRejectedValue(apiError('Forbidden', 403));
    await render(<Harness initial={GSTIN} />);
    expect(container.textContent).not.toMatch(/Verify/);
    expect(get.mock.calls.every(([url]) => String(url).endsWith('/policy'))).toBe(true);
  });
  it('makes no request at all without an entity', async () => {
    const get = mockGets({ enabled: true, mode: 'LIVE' }, () => freshLive());
    await render(<Harness initial={GSTIN} entity={undefined} />);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('GstinVerificationField — local format validation (enabled)', () => {
  it('validates on blur and while a full-length value is invalid, and clears when corrected', async () => {
    const get = mockGets({ enabled: true, mode: 'LIVE' }, () => view());
    await render(<Harness initial="" />);
    await type('33AAAAA');
    expect(container.textContent).not.toContain('valid 15-character');
    await act(async () => input().dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(container.textContent).toContain('Enter a valid 15-character GSTIN');
    // No evidence/verification lookups for an invalid GSTIN.
    expect(verificationGets(get)).toHaveLength(0);
    expect(buttonByLabel('Verify GSTIN')).toBeUndefined();
    await type(GSTIN);
    expect(container.textContent).not.toContain('valid 15-character');
  });
  it('rejects a 15-character value with a bad structure immediately', async () => {
    mockGets({ enabled: true, mode: 'LIVE' }, () => view());
    await render(<Harness initial="" />);
    await type('33AAAAA0000A1Q5');
    expect(container.textContent).toContain('Enter a valid 15-character GSTIN');
  });
  it('lets a lowercase, padded GSTIN verify as its normalized form', async () => {
    const get = mockGets({ enabled: true, mode: 'LIVE' }, () => view());
    await render(<Harness initial={` ${GSTIN.toLowerCase()} `} />);
    expect(verificationGets(get)[0]![1]!.params.gstin).toBe(GSTIN);
  });
  it('keeps focus on the input when typing the final character reveals the Verify action', async () => {
    mockGets({ enabled: true, mode: 'LIVE' }, () => view());
    await render(<Harness initial={GSTIN.slice(0, 14)} />);
    input().focus();
    const before = input();
    await type(GSTIN);
    expect(buttonByLabel('Retrieve Complete Profile')).toBeDefined();
    expect(input()).toBe(before);
    expect(document.activeElement).toBe(before);
  });
});

describe('GstinVerificationField — verification source (create vs edit)', () => {
  it('uses the unsaved-form source while creating, and sends no provider call on read', async () => {
    const get = mockGets({ enabled: true, mode: 'LIVE' }, () => view());
    const post = vi.spyOn(apiClient, 'post');
    await render(<Harness initial={GSTIN} />);
    expect(verificationGets(get)[0]![1]!.params).toEqual({
      gstin: GSTIN,
      sourceType: 'DISTRIBUTOR',
      sourceId: 'NEW',
    });
    expect(post).not.toHaveBeenCalled();
  });
  it('uses the saved record while the input equals the saved GSTIN, and the unsaved source once edited', async () => {
    const get = mockGets({ enabled: true, mode: 'LIVE' }, () => view());
    await render(<Harness initial={GSTIN} recordId="dist-1" savedGstin={GSTIN} />);
    expect(verificationGets(get)[0]![1]!.params).toMatchObject({ sourceId: 'dist-1' });
    await click(buttonByLabel('change-gstin'));
    const last = verificationGets(get).at(-1)![1]!.params;
    expect(last).toEqual({ gstin: OTHER, sourceType: 'DISTRIBUTOR', sourceId: 'NEW' });
  });
  it('never requests an unsaved source when verification is not allowed (display-only)', async () => {
    const get = mockGets({ enabled: true, mode: 'LIVE' }, () => view());
    await render(<Harness initial={GSTIN} allowVerify={false} />);
    expect(verificationGets(get)).toHaveLength(0);
    expect(buttonByLabel('Verify GSTIN')).toBeUndefined();
  });
});

describe('GstinVerificationField — success indicator and profile modal', () => {
  it('shows an accessible green-check button that opens the profile modal without any request', async () => {
    const get = mockGets({ enabled: true, mode: 'LIVE', level: 'COMPLETE' }, () => freshLive());
    const post = vi.spyOn(apiClient, 'post');
    await render(<Harness initial={GSTIN} />);
    const check = buttonByLabel(/verified\. View registration details/);
    expect(check).toBeDefined();
    expect(check!.tagName).toBe('BUTTON');
    expect(check!.getAttribute('aria-label')).toContain(GSTIN);
    // Verified, so there is nothing more to verify.
    expect(buttonByLabel('Retrieve Complete Profile')).toBeUndefined();
    const readsBefore = verificationGets(get).length;
    await click(check);
    const dialog = document.querySelector('[role="dialog"]')!;
    const text = dialog.textContent!;
    for (const expected of [
      GSTIN,
      'Synthetic Traders Pvt Ltd',
      'Synthetic Traders',
      'Regular',
      '2019-04-01',
      '12 Test Street, Tiruppur',
      'Private Limited Company',
      'Government registration: Active',
      'Live evidence',
      'Last verified on',
    ])
      expect(text).toContain(expected);
    // Return filing details (COMPLETE) in the same presentation as the panel.
    await act(async () => dialog.querySelector('summary')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(dialog.textContent).toContain('Filing Frequency');
    expect(dialog.textContent).toContain('GSTR-1 Filed Through');
    expect(dialog.textContent).toContain('GSTR-3B Filed Through');
    expect(dialog.textContent).toContain('Profile Retrieved On');
    // Closing performs no lookup either.
    await click(buttonByLabel('Close'));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(post).not.toHaveBeenCalled();
    expect(verificationGets(get).length).toBe(readsBefore);
  });
  it('shows unavailable and partial results using the existing presentation', async () => {
    mockGets({ enabled: true, mode: 'LIVE' }, () =>
      view({
        cacheState: 'FRESH',
        evidence: evidence({ partial: true, unavailable: ['gstr3b_filed_till'], tradeName: null }),
      }),
    );
    await render(<Harness initial={GSTIN} />);
    await click(buttonByLabel(/verified\. View/));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Information unavailable');
  });
  it('clears the success indicator the moment the GSTIN changes, before any response', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(apiClient, 'get').mockImplementation(async (url, config) => {
      if (url.endsWith('/policy')) return { data: { data: { enabled: true, mode: 'LIVE' } } };
      const params = config?.params as Record<string, string>;
      if (params.gstin === OTHER) await gate;
      return { data: { data: params.gstin === GSTIN ? freshLive() : view() } };
    });
    await render(<Harness initial={GSTIN} />);
    expect(buttonByLabel(/verified\. View/)).toBeDefined();
    await click(buttonByLabel('change-gstin'));
    expect(input().value).toBe(OTHER);
    expect(buttonByLabel(/verified\. View/)).toBeUndefined();
    release();
    await settle();
    // The new GSTIN has no evidence, so it is offered Verify, not a check.
    expect(buttonByLabel(/verified\. View/)).toBeUndefined();
    expect(buttonByLabel('Retrieve Complete Profile')).toBeDefined();
  });
  it('does not show a late response for a previous GSTIN against the new one', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(apiClient, 'get').mockImplementation(async (url, config) => {
      if (url.endsWith('/policy')) return { data: { data: { enabled: true, mode: 'LIVE' } } };
      const params = config?.params as Record<string, string>;
      if (params.gstin === GSTIN) {
        await gate;
        return { data: { data: freshLive() } };
      }
      return { data: { data: view() } };
    });
    await render(<Harness initial={GSTIN} />);
    await click(buttonByLabel('change-gstin'));
    release();
    await settle();
    expect(buttonByLabel(/verified\. View/)).toBeUndefined();
  });
  it('does not call a saved verification fresh when it has expired', async () => {
    mockGets({ enabled: true, mode: 'LIVE' }, () =>
      view({ cacheState: 'FRESH', evidence: evidence({ expiresAt: '2020-01-01T00:00:00Z' }) }),
    );
    await render(<Harness initial={GSTIN} />);
    expect(buttonByLabel(/verified\. View/)).toBeUndefined();
    expect(buttonByLabel(/out of date/)).toBeDefined();
    expect(container.textContent).toContain('Verification is out of date');
  });
  it('flags server-stale evidence and offers an explicit re-verify', async () => {
    mockGets({ enabled: true, mode: 'LIVE' }, () =>
      view({ cacheState: 'STALE', evidence: evidence({ expiresAt: '2020-01-01T00:00:00Z' }) }),
    );
    await render(<Harness initial={GSTIN} />);
    expect(buttonByLabel(/verified\. View/)).toBeUndefined();
    expect(buttonByLabel('Reverify GSTIN')).toBeDefined();
    await click(buttonByLabel(/out of date/));
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Stale');
  });
  it('does not treat Basic evidence as a verified Complete Profile', async () => {
    mockGets({ enabled: true, mode: 'LIVE', level: 'COMPLETE' }, () =>
      view({ cacheState: 'BASIC_ONLY', evidence: evidence({ level: 'BASIC' }) }),
    );
    await render(<Harness initial={GSTIN} />);
    expect(buttonByLabel(/verified\. View/)).toBeUndefined();
    expect(container.textContent).toContain('Only a Basic verification is available');
    expect(buttonByLabel('Retrieve Complete Profile')).toBeDefined();
    await click(buttonByLabel(/Basic verification is available/));
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain(
      'Fresh Complete Profile information is unavailable',
    );
  });
  it('accepts Basic evidence where Basic is the configured level', async () => {
    mockGets({ enabled: true, mode: 'LIVE', level: 'BASIC' }, () =>
      view({ level: 'BASIC', cacheState: 'FRESH', evidence: evidence({ level: 'BASIC' }) }),
    );
    await render(<Harness initial={GSTIN} />);
    expect(buttonByLabel(/verified\. View/)).toBeDefined();
  });
  it('does not call a cancelled registration verified', async () => {
    mockGets({ enabled: true, mode: 'LIVE' }, () =>
      view({ cacheState: 'FRESH', evidence: evidence({ governmentStatus: 'CANCELLED' }) }),
    );
    await render(<Harness initial={GSTIN} />);
    expect(buttonByLabel(/verified\. View/)).toBeUndefined();
    expect(container.textContent).toContain('Registration status: Cancelled');
  });
});

describe('GstinVerificationField — Demo Mode', () => {
  const demoView = (overrides: Partial<GstVerificationView> = {}) =>
    view({
      mode: 'DEMO',
      level: 'BASIC',
      canVerify: true,
      cacheState: 'FRESH',
      evidence: evidence({
        mode: 'DEMO',
        level: 'BASIC',
        lookupGstin: '00AAAAA0000A1ZT',
        returnedGstin: '00AAAAA0000A1ZT',
        legalName: 'GSTINAPI TEST PRIVATE LIMITED',
        billingCategory: 'test',
        estimatedCredits: 0,
      }),
      ...overrides,
    });
  it('labels a sample result, never shows the green check, and never claims the entered GSTIN is verified', async () => {
    mockGets({ enabled: true, mode: 'DEMO', level: 'BASIC' }, () => demoView());
    await render(<Harness initial={GSTIN} />);
    expect(container.textContent).toContain('Demo Sample');
    expect(container.textContent).toContain('This GSTIN is not verified');
    expect(buttonByLabel(/verified\. View/)).toBeUndefined();
    const sample = buttonByLabel(/Demo sample result, not a verification/);
    expect(sample).toBeDefined();
    await click(sample);
    const text = document.querySelector('[role="dialog"]')!.textContent!;
    expect(text).toContain('The entered GSTIN has not been verified');
    expect(text).toContain('Sample GSTIN');
    expect(text).toContain('Demo sample');
    expect(text).toContain('Demo Mode');
  });
  it('runs the official sample lookup from an explicit Verify click, with no confirmation dialog', async () => {
    let current = view({ mode: 'DEMO', level: 'BASIC', cacheState: 'NONE' });
    const get = mockGets({ enabled: true, mode: 'DEMO', level: 'BASIC' }, () => current);
    const post = vi.spyOn(apiClient, 'post').mockImplementation(async (url) => {
      if (url.endsWith('/prepare'))
        return {
          data: {
            data: {
              kind: 'CONFIRMATION',
              intentId: 'intent-1',
              gstin: GSTIN,
              mode: 'DEMO',
              level: 'BASIC',
              estimatedCredits: 0,
              freshCacheAvailable: false,
              refresh: false,
              expiresAt: '2099-01-01T00:00:00Z',
            },
          },
        };
      current = demoView();
      return { data: { data: current } };
    });
    await render(<Harness initial={GSTIN} />);
    expect(post).not.toHaveBeenCalled();
    await click(buttonByLabel('Verify GSTIN'));
    expect(post.mock.calls.map(([url]) => url.split('/').pop())).toEqual(['prepare', 'execute']);
    expect(post.mock.calls[0]![1]).toEqual({
      target: { gstin: GSTIN, source: { type: 'DISTRIBUTOR', id: 'NEW' } },
      refresh: false,
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain('Demo Sample');
    expect(buttonByLabel(/verified\. View/)).toBeUndefined();
    void get;
  });
});

describe('GstinVerificationField — Live lookups', () => {
  const confirmation = {
    kind: 'CONFIRMATION',
    intentId: 'intent-live',
    gstin: GSTIN,
    mode: 'LIVE',
    level: 'COMPLETE',
    estimatedCredits: 2,
    freshCacheAvailable: false,
    refresh: false,
    expiresAt: '2099-01-01T00:00:00Z',
  };
  it('never calls the provider automatically: a click only prepares, and the explicit confirmation executes', async () => {
    let current = view({ cacheState: 'NONE' });
    mockGets({ enabled: true, mode: 'LIVE', level: 'COMPLETE' }, () => current);
    const post = vi.spyOn(apiClient, 'post').mockImplementation(async (url) => {
      if (url.endsWith('/prepare')) return { data: { data: confirmation } };
      current = freshLive();
      return { data: { data: current } };
    });
    await render(<Harness initial={GSTIN} />);
    await type(GSTIN); // re-rendering / retyping the same value changes nothing
    expect(post).not.toHaveBeenCalled();

    await click(buttonByLabel('Retrieve Complete Profile'));
    expect(post.mock.calls.map(([url]) => url.split('/').pop())).toEqual(['prepare']);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain(GSTIN);
    expect(dialog.textContent).toContain('Live Mode');
    expect(dialog.textContent).toContain('2 API credits');

    // Cancelling makes no execution request.
    await click([...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Cancel'));
    expect(post.mock.calls.map(([url]) => url.split('/').pop())).toEqual(['prepare']);

    await click(buttonByLabel('Retrieve Complete Profile'));
    await click([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === 'Proceed'));
    expect(post.mock.calls.map(([url]) => url.split('/').pop())).toEqual(['prepare', 'prepare', 'execute']);
    expect(post.mock.calls[2]![1]).toEqual({ intentId: 'intent-live' });
    expect(buttonByLabel(/verified\. View registration details/)).toBeDefined();
  });
  it('reuses fresh cached evidence and offers no new lookup', async () => {
    mockGets({ enabled: true, mode: 'LIVE' }, () => freshLive());
    const post = vi.spyOn(apiClient, 'post');
    await render(<Harness initial={GSTIN} />);
    expect(buttonByLabel(/^(Verify|Retrieve|Reverify)/)).toBeUndefined();
    expect(post).not.toHaveBeenCalled();
  });
  it('offers Reverify only inside the modal and only to a user who may refresh', async () => {
    mockGets({ enabled: true, mode: 'LIVE' }, () => ({ ...freshLive(), canRefresh: true }));
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: { ...confirmation, refresh: true } } });
    await render(<Harness initial={GSTIN} />);
    await click(buttonByLabel(/verified\. View/));
    expect(post).not.toHaveBeenCalled();
    await click(buttonByLabel('Reverify GSTIN'));
    expect(post.mock.calls[0]![1]).toMatchObject({ refresh: true });
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Reverify GSTIN');
  });
});

describe('GstinVerificationField — failures and authorization', () => {
  it('shows an understandable field-level message when the provider is unavailable, and stays usable', async () => {
    mockGets({ enabled: true, mode: 'DEMO', level: 'BASIC' }, () =>
      view({ mode: 'DEMO', level: 'BASIC', cacheState: 'NONE' }),
    );
    vi.spyOn(apiClient, 'post').mockRejectedValue(
      apiError('The registration service is temporarily unavailable.'),
    );
    await render(<Harness initial={GSTIN} />);
    await click(buttonByLabel('Verify GSTIN'));
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('The registration service is temporarily unavailable.');
    expect(input().getAttribute('aria-invalid')).toBeNull(); // not a validation error
    expect(buttonByLabel('Verify GSTIN')).toBeDefined(); // can try again
    expect(buttonByLabel(/verified\. View/)).toBeUndefined();
  });
  it('explains an unavailable API key as a message, not a verification', async () => {
    mockGets({ enabled: true, mode: 'LIVE' }, () => view());
    vi.spyOn(apiClient, 'post').mockRejectedValue(
      apiError('Online verification is unavailable. Ask your administrator to check its configuration.'),
    );
    await render(<Harness initial={GSTIN} />);
    await click(buttonByLabel('Retrieve Complete Profile'));
    expect(container.textContent).toContain('Ask your administrator to check its configuration');
    expect(buttonByLabel(/verified\. View/)).toBeUndefined();
  });
  it('offers a non-Accountant no Live lookup and says why', async () => {
    mockGets({ enabled: true, mode: 'LIVE' }, () => view({ canVerify: false, canRefresh: false }));
    const post = vi.spyOn(apiClient, 'post');
    await render(<Harness initial={GSTIN} />);
    expect(buttonByLabel(/^(Verify|Retrieve)/)).toBeUndefined();
    expect(container.textContent).toContain('Live verification requires an Accountant');
    expect(post).not.toHaveBeenCalled();
  });
  it('still shows existing evidence to a role that may not request a lookup', async () => {
    mockGets({ enabled: true, mode: 'LIVE' }, () => ({ ...freshLive(), canVerify: false }));
    await render(<Harness initial={GSTIN} />);
    expect(buttonByLabel(/verified\. View/)).toBeDefined();
  });
  it('degrades quietly to a plain field when the role cannot read verification at all', async () => {
    mockGets({ enabled: true, mode: 'LIVE' }, () => apiError('Forbidden', 403));
    await render(<Harness initial={GSTIN} />);
    expect(buttonByLabel(/^(Verify|Retrieve)/)).toBeUndefined();
    expect(container.textContent).toContain('Verification status is unavailable. Saving remains available.');
    expect(input().value).toBe(GSTIN);
  });
  it('does not offer a lookup on a disabled field', async () => {
    mockGets({ enabled: true, mode: 'LIVE' }, () => view());
    await render(<Harness initial={GSTIN} disabled />);
    expect(buttonByLabel(/^(Verify|Retrieve)/)).toBeUndefined();
  });
});

describe('GstinVerificationField — form integrity', () => {
  it('never submits the surrounding form from its own buttons and never edits other fields', async () => {
    mockGets({ enabled: true, mode: 'LIVE' }, () => freshLive());
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    await render(
      <form onSubmit={onSubmit}>
        <input aria-label="other" defaultValue="untouched" />
        <Harness initial={GSTIN} />
      </form>,
    );
    await click(buttonByLabel(/verified\. View/));
    await click(buttonByLabel('Close'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect((container.querySelector('input[aria-label="other"]') as HTMLInputElement).value).toBe('untouched');
  });
});

describe('GstinVerificationInline (saved-record presentation)', () => {
  it('shows the GSTIN with the same badge and modal, via the saved record source', async () => {
    const get = mockGets({ enabled: true, mode: 'LIVE' }, () => freshLive());
    await render(<GstinVerificationInline gstin={GSTIN} entity="FACTORY" recordId="fac-1" />);
    expect(container.textContent).toContain(GSTIN);
    expect(verificationGets(get)[0]![1]!.params).toEqual({
      gstin: GSTIN,
      sourceType: 'FACTORY',
      sourceId: 'fac-1',
    });
    await click(buttonByLabel(/verified\. View/));
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Synthetic Traders Pvt Ltd');
  });
  it('shows a placeholder and makes no request when a record has no GSTIN', async () => {
    const get = mockGets({ enabled: true, mode: 'LIVE' }, () => freshLive());
    await render(<GstinVerificationInline gstin={null} entity="FACTORY" recordId="fac-1" />);
    expect(container.textContent).toBe('—');
    expect(verificationGets(get)).toHaveLength(0);
  });
});

describe('GstinVerificationField — display-only versus authorized verification', () => {
  const staleView = () =>
    view({ cacheState: 'STALE', evidence: evidence({ expiresAt: '2020-01-01T00:00:00Z' }) });

  it('a readOnly field is display-only by default: evidence shows, no lookup is offered or requested', async () => {
    mockGets({ enabled: true, mode: 'DEMO', level: 'BASIC' }, () => view({ mode: 'DEMO', cacheState: 'NONE' }));
    const post = vi.spyOn(apiClient, 'post');
    await render(<Harness initial={GSTIN} readOnly recordId="dist-1" savedGstin={GSTIN} />);
    expect(buttonByLabel(/^(Verify|Retrieve|Reverify)/)).toBeUndefined();
    expect(input().readOnly).toBe(true);
    expect(post).not.toHaveBeenCalled();
  });
  it('a readOnly field still shows and explains existing evidence, but offers no re-verify', async () => {
    mockGets({ enabled: true, mode: 'LIVE' }, () => ({ ...staleView(), canRefresh: true }));
    await render(<Harness initial={GSTIN} readOnly recordId="dist-1" savedGstin={GSTIN} />);
    expect(buttonByLabel(/^(Verify|Retrieve|Reverify)/)).toBeUndefined();
    await click(buttonByLabel(/out of date/));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Synthetic Traders Pvt Ltd');
    expect([...dialog.querySelectorAll('button')].map((b) => b.textContent)).not.toContain('Reverify GSTIN');
  });
  it('a readOnly field never reads an unsaved source', async () => {
    const get = mockGets({ enabled: true, mode: 'LIVE' }, () => view());
    await render(<Harness initial={GSTIN} readOnly />);
    expect(verificationGets(get)).toHaveLength(0);
  });
  it('an authorized detail page can opt in explicitly: the same readOnly field then offers Verify', async () => {
    mockGets({ enabled: true, mode: 'LIVE' }, () => view({ canVerify: true }));
    const post = vi.spyOn(apiClient, 'post');
    await render(<Harness initial={GSTIN} readOnly allowVerify recordId="store-1" savedGstin={GSTIN} entity="RETAIL_STORE" />);
    expect(buttonByLabel('Retrieve Complete Profile')).toBeDefined();
    expect(input().readOnly).toBe(true);
    // Offered, not performed.
    expect(post).not.toHaveBeenCalled();
  });
  it('authorization still decides: an opted-in readOnly field offers nothing to a role that cannot verify', async () => {
    mockGets({ enabled: true, mode: 'LIVE' }, () => view({ canVerify: false }));
    await render(<Harness initial={GSTIN} readOnly allowVerify recordId="store-1" savedGstin={GSTIN} />);
    expect(buttonByLabel(/^(Verify|Retrieve|Reverify)/)).toBeUndefined();
  });
  it('an editable field offers Verify by default', async () => {
    mockGets({ enabled: true, mode: 'LIVE' }, () => view());
    await render(<Harness initial={GSTIN} />);
    expect(buttonByLabel('Retrieve Complete Profile')).toBeDefined();
  });
});
