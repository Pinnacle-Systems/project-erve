/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@erve/types';
import { setSessionTiming, toSessionTiming } from '@erve/client';
import { apiClient, AUTH_EXPIRED_EVENT } from '../../lib/api-client.js';
import { AuthProvider } from '../../auth/AuthContext.js';
import { SessionManager } from '../../auth/session/SessionManager.js';
import { setStoredToken } from '../../auth/token-storage.js';
import { sessionInfo } from '../../test-support/session.js';
import { StyleFormPage } from './StyleFormPage.js';

const USER: AuthUser = {
  id: 'merch-1',
  email: 'merch@test.local',
  mobile: null,
  name: 'Merchandiser',
  roles: ['MERCHANDISER'],
};

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
  sessionStorage.clear();
  localStorage.clear();
  setSessionTiming(toSessionTiming(sessionInfo(USER.id)));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setSessionTiming(null);
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function mockApi() {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { data: USER } };
    if (url === '/sizes/options') return { data: { data: [] } };
    if (url === '/factories/options') return { data: { data: [] } };
    if (url === '/seasons/options') return { data: { data: [] } };
    throw new Error(`Unexpected GET ${url}`);
  });
  return vi.spyOn(apiClient, 'post').mockImplementation(async (url: string) => {
    if (url === '/auth/login') {
      return {
        data: { data: { accessToken: 'reauth-token', user: USER, session: sessionInfo(USER.id) } },
      };
    }
    throw new Error(`Unexpected POST ${url}`);
  });
}

async function renderCreateStyle() {
  setStoredToken('access-token');
  act(() => {
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AuthProvider onHardNavigate={vi.fn()}>
          <MemoryRouter initialEntries={['/master-data/styles/new']}>
            <Routes>
              <Route path="/master-data/styles/new" element={<StyleFormPage />} />
            </Routes>
          </MemoryRouter>
          <SessionManager />
        </AuthProvider>
      </QueryClientProvider>,
    );
  });
  await flush();
}

function field(id: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`#${id}`);
  if (!input) throw new Error(`Missing field #${id}`);
  return input;
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function beforeUnloadPrevented(): boolean {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('StyleFormPage — session reliability', () => {
  it('does not guard browser unload while the form is untouched', async () => {
    mockApi();
    await renderCreateStyle();

    expect(beforeUnloadPrevented()).toBe(false);
  });

  it('guards browser refresh/close once the Style form has unsaved input', async () => {
    mockApi();
    await renderCreateStyle();

    typeInto(field('field-style-number'), 'STY-9001');

    expect(beforeUnloadPrevented()).toBe(true);
  });

  it('keeps entered Style data through session expiry and in-place re-authentication', async () => {
    const post = mockApi();
    await renderCreateStyle();
    typeInto(field('field-style-number'), 'STY-9001');
    typeInto(field('field-style-name'), 'Monsoon Kurta');

    await act(async () => {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    });
    await flush();

    expect(document.body.textContent).toContain('Sign in to continue');
    expect(field('field-style-number').value).toBe('STY-9001');

    typeInto(document.getElementById('reauth-password') as HTMLInputElement, 'secret');
    await act(async () => {
      document.querySelector<HTMLFormElement>('#reauth-password')!.form!.requestSubmit();
    });
    await flush();

    expect(document.body.textContent).not.toContain('Sign in to continue');
    expect(field('field-style-number').value).toBe('STY-9001');
    expect(field('field-style-name').value).toBe('Monsoon Kurta');
    // Nothing was saved or replayed on the user's behalf.
    expect(post.mock.calls.map(([url]) => url)).toEqual(['/auth/login']);
    // Still dirty, still protected.
    expect(beforeUnloadPrevented()).toBe(true);
  });
});
