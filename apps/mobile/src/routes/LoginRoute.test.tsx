/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  status: 'unauthenticated' as 'loading' | 'authenticated' | 'unauthenticated' | 'unavailable',
  retrySession: vi.fn(),
}));

vi.mock('../auth/AuthContext.js', () => ({
  useAuth: () => ({ status: auth.status, retrySession: auth.retrySession }),
}));

vi.mock('../pages/LoginPage.js', () => ({
  LoginPage: () => <div>Login form</div>,
}));

import { LoginRoute } from './LoginRoute.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  auth.status = 'unauthenticated';
  auth.retrySession.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderRoute() {
  act(() => {
    root.render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/dashboard" element={<div>Dashboard</div>} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

describe('LoginRoute', () => {
  it('redirects a restored authenticated session away from login', () => {
    auth.status = 'authenticated';
    renderRoute();
    expect(container.textContent).toBe('Dashboard');
  });

  it('preserves an offline session and offers a retry instead of showing login', () => {
    auth.status = 'unavailable';
    renderRoute();
    expect(container.textContent).toContain('Temporarily unavailable');
    expect(container.textContent).not.toContain('Login form');
    const screen = container.querySelector('main');
    expect(screen?.className).toContain('h-full');
    expect(screen?.className).toContain('min-h-0');
    expect(screen?.className).toContain('overflow-hidden');
  });

  it('contains session restoration inside the viewport without a nested scroller', () => {
    auth.status = 'loading';
    renderRoute();

    const screen = container.querySelector('main[aria-label="Restoring session"]');
    expect(screen?.className).toContain('h-full');
    expect(screen?.className).toContain('min-h-0');
    expect(screen?.className).toContain('overflow-hidden');
  });
});
