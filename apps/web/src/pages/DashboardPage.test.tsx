/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, Role } from '@erve/types';
import * as AuthContext from '../auth/AuthContext.js';

// This file tests DashboardPage's role branch only (RPT2) — the reporting
// Dashboard's own content/filters/loading/error/empty behavior has its own
// test file (dashboard/ManagementDashboardPage.test.tsx).
vi.mock('./dashboard/ManagementDashboardPage.js', () => ({
  ManagementDashboardPage: () => <div>ManagementDashboardPage</div>,
}));

import { DashboardPage } from './DashboardPage.js';

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
  it.each(['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT'] as const)(
    '%s (V1 reporting audience) sees the management reporting Dashboard, not the shortcut placeholder',
    async (role) => {
      await renderDashboard(role);
      expect(container.textContent).toContain('ManagementDashboardPage');
      expect(getButtonTexts()).not.toContain('Master Data');
    },
  );

  it('FACTORY_USER sees Job Orders but not Master Data or Order Sheets', async () => {
    await renderDashboard('FACTORY_USER');
    const labels = getButtonTexts();
    expect(labels).not.toContain('Master Data');
    expect(labels).not.toContain('Order Sheets');
    expect(labels).toContain('Job Orders');
    expect(container.textContent).not.toContain('ManagementDashboardPage');
  });

  it('directs QA_USER to the shared Job Orders workflow, not the reporting Dashboard', async () => {
    await renderDashboard('QA_USER');
    expect(getButtonTexts()).toContain('Job Orders');
    expect(container.textContent).not.toContain('ManagementDashboardPage');
  });
});
