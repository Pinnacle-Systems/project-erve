/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../lib/api-client.js';
import { LoginPage } from './LoginPage.js';

vi.mock('../auth/AuthContext.js', () => ({
  useAuth: () => ({ login: vi.fn() }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
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

async function submitFailedLogin(error: unknown): Promise<void> {
  vi.spyOn(apiClient, 'post').mockRejectedValue(error);
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });

  expect(container.textContent).not.toContain('Unable to sign in. Please try again.');
  const form = container.querySelector('form');
  expect(form).not.toBeNull();

  await act(async () => {
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('LoginPage error feedback', () => {
  it('renders shared role-neutral sign-in instructions and accessible field labels', async () => {
    await submitFailedLogin(new Error('offline'));
    expect(container.textContent).toContain('Sign in to your Erve account');
    expect(container.textContent?.toLowerCase()).not.toContain('distributor');
    expect(container.querySelector('label[for="identifier"]')?.textContent).toContain('Email or mobile number');
    expect(container.querySelector('label[for="password"]')?.textContent).toContain('Password');
    expect(container.querySelector('button[type="submit"]')?.textContent).toBe('Sign in');
  });
  it('shows a generic failure message for a non-Axios rejection', async () => {
    await submitFailedLogin(new Error('Unexpected network failure'));
    expect(container.textContent).toContain('Unable to sign in. Please try again.');
  });

  it('preserves a server-provided message for an Axios rejection', async () => {
    await submitFailedLogin({
      isAxiosError: true,
      response: { data: { error: { message: 'Invalid credentials' } } },
    });
    expect(container.textContent).toContain('Invalid credentials');
    expect(container.textContent).not.toContain('Unable to sign in. Please try again.');
  });
});
