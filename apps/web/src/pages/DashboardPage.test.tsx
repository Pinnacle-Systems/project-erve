/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, Role } from '@erve/types';
import { DashboardPage } from './DashboardPage.js';
import * as AuthContext from '../auth/AuthContext.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const renderDashboard = async (role: Role) => {
  const user: AuthUser = {
    id: 'user-1',
    email: 'test@test.local',
    mobile: null,
    name: 'Test User',
    roles: [role],
  };

  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    user,
    token: 'valid-token',
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    isInitializing: false,
  } as unknown as ReturnType<typeof AuthContext.useAuth>);

  act(() => {
    root.render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
  });
  
  await act(async () => {
    await flushMicrotasks();
  });
};

function getButtonTexts(): string[] {
  return Array.from(container.querySelectorAll('button')).map((btn) => btn.textContent ?? '');
}

describe('DashboardPage', () => {
  it('ADMIN sees Master Data, Purchase Orders, and Job Orders shortcuts', async () => {
    await renderDashboard('ADMIN');
    const labels = getButtonTexts();
    expect(labels).toContain('Master Data');
    expect(labels).toContain('Purchase Orders');
    expect(labels).toContain('Job Orders');
  });

  it('MERCHANDISER sees Master Data, Purchase Orders, and Job Orders shortcuts', async () => {
    await renderDashboard('MERCHANDISER');
    const labels = getButtonTexts();
    expect(labels).toContain('Master Data');
    expect(labels).toContain('Purchase Orders');
    expect(labels).toContain('Job Orders');
  });

  it('FACTORY_USER sees Job Orders but not Master Data or Purchase Orders', async () => {
    await renderDashboard('FACTORY_USER');
    const labels = getButtonTexts();
    expect(labels).not.toContain('Master Data');
    expect(labels).not.toContain('Purchase Orders');
    expect(labels).toContain('Job Orders');
  });
});
