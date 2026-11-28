/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { apiClient } from '@erve/client';

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  status: vi.fn(),
  remove: vi.fn(),
  set: vi.fn(),
  login: vi.fn(),
  switchToBiometrics: vi.fn(),
  biometricLock: null as 'device' | null,
}));

vi.mock('../auth/secure-session.js', () => ({
  nativeBiometric: { status: mocks.status, remove: mocks.remove },
  nativeSecureSession: { isAvailable: () => true, set: mocks.set, clear: vi.fn() },
}));

vi.mock('../auth/AuthContext.js', () => ({
  useAuth: () => ({
    login: mocks.login,
    loginNotice: null,
    biometricLock: mocks.biometricLock,
    switchToBiometrics: mocks.switchToBiometrics,
  }),
}));

vi.mock('../branding/PoweredByPinnacleBranding.js', () => ({
  PoweredByPinnacleBranding: () => null,
}));

import { LoginPage } from './LoginPage.js';

let container: HTMLDivElement;
let root: Root;
let original: typeof apiClient.defaults.adapter;

function respond(config: InternalAxiosRequestConfig, data: unknown): AxiosResponse {
  return { data: { success: true, data }, status: 200, statusText: 'OK', headers: {}, config };
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  original = apiClient.defaults.adapter;
  mocks.order = [];
  mocks.biometricLock = null;
  mocks.status.mockReset();
  mocks.remove.mockReset().mockImplementation(async () => void mocks.order.push('remove'));
  mocks.set.mockReset().mockImplementation(async () => void mocks.order.push('set'));
  mocks.login.mockReset();
  mocks.switchToBiometrics.mockReset();
  apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) =>
    respond(config, {
      accessToken: 'access',
      refreshToken: 'refresh',
      user: { id: 'user-2', email: 'b@test.local', mobile: null, name: 'B', roles: ['QA_USER'] },
    }),
  ) satisfies AxiosAdapter;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  apiClient.defaults.adapter = original;
});

async function renderPage() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}

async function submit() {
  const form = container.querySelector('form')!;
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('LoginPage — biometric registration on this phone', () => {
  it("drops another account's biometric key (remembering its server record) before storing the new session", async () => {
    mocks.status.mockResolvedValue({ enabled: true, userId: 'user-1' });
    await renderPage();
    await submit();

    expect(mocks.order).toEqual(['remove', 'set']);
    expect(mocks.remove).toHaveBeenCalledWith({ keepPendingRevocation: true });
    expect(mocks.set).toHaveBeenCalledWith('refresh');
    expect(mocks.login).toHaveBeenCalledWith('access', expect.objectContaining({ id: 'user-2' }));
  });

  it('keeps the registration when the same account signs in again with its password', async () => {
    mocks.status.mockResolvedValue({ enabled: true, userId: 'user-2' });
    await renderPage();
    await submit();

    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.set).toHaveBeenCalledWith('refresh');
  });

  it('keeps nothing to remove when no biometric login is registered', async () => {
    mocks.status.mockResolvedValue({ enabled: false, userId: null });
    await renderPage();
    await submit();

    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.login).toHaveBeenCalledTimes(1);
  });

  it('offers a way back to biometric sign-in only while this phone is registered', async () => {
    await renderPage();
    expect(container.textContent).not.toContain('Sign in with biometrics');
    act(() => root.unmount());

    root = createRoot(container);
    mocks.biometricLock = 'device';
    await renderPage();
    const back = [...container.querySelectorAll('button')].find(
      (el) => el.textContent === 'Sign in with biometrics',
    );
    expect(back).toBeTruthy();
    act(() => back!.click());
    expect(mocks.switchToBiometrics).toHaveBeenCalledTimes(1);
  });
});
