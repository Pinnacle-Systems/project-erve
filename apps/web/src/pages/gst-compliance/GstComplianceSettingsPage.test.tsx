/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, GstComplianceSettings } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import { GstComplianceSettingsPage } from './GstComplianceSettingsPage.js';

const auth = vi.hoisted(() => ({ roles: ['ACCOUNTANT'] }));
vi.mock('../../auth/AuthContext.js', () => ({ useAuth: () => ({ user: { id: 'accounts', roles: auth.roles } as AuthUser }) }));
let root: Root;
let container: HTMLDivElement;
const defaults = (): GstComplianceSettings => ({
  integrationMode: 'DEMO', onlineGstinVerificationEnabled: false, gstinVerificationLevel: 'BASIC',
  ewayBillGenerationEnabled: false, version: 0, updatedAt: null, updatedBy: null,
  capabilities: { liveActivationAvailable: false, onlineVerificationAvailable: false, ewayBillGenerationAvailable: false },
});
let persisted: GstComplianceSettings;
beforeEach(() => {
  auth.roles = ['ACCOUNTANT'];
  persisted = defaults();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url) => ({ data: { success: true, data: url.endsWith('/audit') ? [] : persisted } }));
  vi.spyOn(apiClient, 'patch').mockImplementation(async (_url, body) => {
    const values = body as Partial<GstComplianceSettings>;
    persisted = { ...persisted, ...values, version: persisted.version + 1, updatedAt: '2026-10-20T10:00:00Z', updatedBy: { id: 'accounts', name: 'Accounts' } };
    return { data: { success: true, data: persisted } };
  });
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); }); }
async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}><GstComplianceSettingsPage /></QueryClientProvider>));
  await settle();
}
function button(text: string) {
  const element = [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === text);
  if (!element) throw new Error(`Missing button: ${text}`);
  return element;
}
function control(role: string, label: string) {
  const element = [...container.querySelectorAll<HTMLButtonElement>(`[role="${role}"]`)].find((item) => item.getAttribute('aria-label') === label || document.querySelector(`label[for="${item.id}"]`)?.textContent?.trim().startsWith(label));
  if (!element) throw new Error(`Missing ${label}`);
  return element;
}

describe('GST Compliance Settings page', () => {
  it('shows safe defaults, estimated costs, unavailable generation and disabled detail controls', async () => {
    await mount();
    expect(container.textContent).toContain('GST Compliance Settings');
    expect(container.textContent).toContain('Basic Verification — 1 credit');
    expect(container.textContent).toContain('Complete Profile — 2 credits');
    expect(container.textContent).toContain('0 credits');
    expect(control('radio', 'Basic Verification — 1 credit').disabled).toBe(true);
    expect(control('switch', 'Enable E-Way Bill Generation').disabled).toBe(true);
    expect(control('radio', 'Live Mode').disabled).toBe(true);
    expect(container.textContent).not.toMatch(/gstinapi|x-api-key|View Filing Dates/);
  });
  it('saves independent preferences without lookups and reloads persisted values', async () => {
    await mount();
    await act(async () => control('switch', 'Enable Online GSTIN Verification').click());
    await act(async () => control('radio', 'Complete Profile — 2 credits').click());
    expect(container.textContent).toContain('Estimated live lookup: 2 credits');
    expect(apiClient.patch).not.toHaveBeenCalled();
    await act(async () => button('Save changes').click()); await settle();
    expect(persisted).toMatchObject({ onlineGstinVerificationEnabled: true, gstinVerificationLevel: 'COMPLETE', integrationMode: 'DEMO' });
    expect(container.textContent).toContain('Settings saved');
    expect(container.textContent).toContain('Accounts');
    await mount();
    expect(control('radio', 'Complete Profile — 2 credits').getAttribute('aria-checked')).toBe('true');
    await act(async () => control('switch', 'Enable Online GSTIN Verification').click());
    expect(container.textContent).not.toContain('Settings saved');
    expect(vi.mocked(apiClient.get).mock.calls.every(([url]) => url.startsWith('/gst-compliance/settings'))).toBe(true);
  });
  it('does not offer ADMIN mutation controls', async () => {
    auth.roles = ['ADMIN']; await mount();
    expect(container.textContent).toContain('Only an Accountant can change');
    expect([...container.querySelectorAll('button')].some((item) => item.textContent === 'Save changes')).toBe(false);
    expect(control('switch', 'Enable Online GSTIN Verification').disabled).toBe(true);
  });
  it('does not fetch configuration for a role without read permission', async () => {
    auth.roles = ['MERCHANDISER']; await mount();
    expect(apiClient.get).not.toHaveBeenCalled();
    expect(container.textContent).toContain('do not have permission');
  });
  it('requires explicit confirmation before authorized Live activation', async () => {
    persisted.capabilities.liveActivationAvailable = true; await mount();
    await act(async () => control('radio', 'Live Mode').click());
    await act(async () => button('Save changes').click());
    expect(apiClient.patch).not.toHaveBeenCalled();
    await act(async () => button('Activate Live Mode').click()); await settle();
    expect(vi.mocked(apiClient.patch).mock.calls[0]?.[1]).toMatchObject({ integrationMode: 'LIVE', confirmLiveActivation: true });
  });
  it('retains the draft after a conflict and provides an explicit reload', async () => {
    vi.mocked(apiClient.patch).mockRejectedValue(new Error('Settings changed. Reload before saving.'));
    await mount();
    await act(async () => control('switch', 'Enable Online GSTIN Verification').click());
    await act(async () => button('Save changes').click()); await settle();
    expect(container.textContent).toContain('Settings changed. Reload before saving.');
    expect(control('switch', 'Enable Online GSTIN Verification').getAttribute('aria-checked')).toBe('true');
    expect(button('Reload settings')).toBeTruthy();
  });
  it('shows loading and load failure without an editable default form', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error('Service unavailable'));
    await mount(); await settle();
    expect(container.textContent).toContain('Unable to load GST Compliance Settings');
    expect(container.querySelector('[role="switch"]')).toBeNull();
  });
  it('keeps the page read-only while loading and prevents duplicate pending saves', async () => {
    let finishRead!: (value: unknown) => void;
    const initialGet = vi.mocked(apiClient.get).getMockImplementation()!;
    vi.mocked(apiClient.get).mockImplementation((url, config) => url === '/gst-compliance/settings' ? new Promise((resolve) => { finishRead = resolve; }) as ReturnType<typeof apiClient.get> : initialGet(url, config));
    await mount();
    expect(container.textContent).toContain('Loading GST Compliance Settings');
    expect(container.querySelector('[role="switch"]')).toBeNull();
    await act(async () => finishRead({ data: { success: true, data: persisted } })); await settle();
    let finishSave!: (value: unknown) => void;
    vi.mocked(apiClient.patch).mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }) as ReturnType<typeof apiClient.patch>);
    await act(async () => control('switch', 'Enable Online GSTIN Verification').click());
    await act(async () => { button('Save changes').click(); button('Save changes').click(); });
    expect(apiClient.patch).toHaveBeenCalledTimes(1);
    expect(control('switch', 'Enable Online GSTIN Verification').disabled).toBe(true);
    await act(async () => finishSave({ data: { success: true, data: { ...persisted, onlineGstinVerificationEnabled: true, version: 1 } } })); await settle();
  });
});
