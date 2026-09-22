import { act } from 'react';
import type { Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, vi } from 'vitest';
import { apiClient } from '../../../lib/api-client.js';
import { JobOrderDetailPage } from '../JobOrderDetailPage.js';
import { mockJobOrder, type Audit, type MockJobOrderStage } from './fixtures.js';

// MemoryRouter keeps its own in-memory history — it never syncs to
// `window.location` — so ?tab= assertions read the router's own location
// via this hidden probe instead.
function LocationEcho() {
  const location = useLocation();
  return (
    <span data-testid="location-probe" hidden>
      {location.pathname + location.search}
    </span>
  );
}

export function getLocationSearch(container: HTMLElement): string {
  const probe = container.querySelector('[data-testid="location-probe"]');
  const text = probe?.textContent ?? '';
  const queryIndex = text.indexOf('?');
  return queryIndex === -1 ? '' : text.slice(queryIndex);
}

export type JobOrderTabLabel = 'Overview' | 'Production' | 'Quality' | 'History';

export interface RenderJobOrderDetailOptions {
  status?: string;
  stages?: MockJobOrderStage[];
  audits?: Audit[];
  overrides?: Record<string, unknown>;
  /** Deep-link straight into a tab (and/or other query params) instead of the default /job-orders/jo-1. */
  initialPath?: string;
  /** Extra `GET` responses keyed by exact URL — e.g. the Style lookup the Production Plan editor issues. */
  extraGetResponses?: Record<string, unknown>;
}

/**
 * Shared render for the Job Order detail page tests — one router/provider
 * stack and one Job Order + audit GET mock, reused by every split test file
 * instead of each duplicating the same boilerplate.
 */
export async function renderJobOrderDetail(
  container: HTMLElement,
  root: Root,
  options: RenderJobOrderDetailOptions = {},
): Promise<void> {
  const {
    status = 'DRAFT',
    stages,
    audits = [],
    overrides = {},
    initialPath = '/job-orders/jo-1',
    extraGetResponses = {},
  } = options;

  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url.endsWith('/audit')) return { data: { data: audits } };
    if (url in extraGetResponses) return { data: { data: extraGetResponses[url] } };
    return { data: { data: mockJobOrder(status, stages, overrides) } };
  });

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialPath]}>
          <LocationEcho />
          <Routes>
            <Route path="/job-orders/:id" element={<JobOrderDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });

  await vi.waitFor(() => expect(container.textContent).not.toContain('Loading job order'));
}

export function content(container: HTMLElement): string {
  return container.textContent ?? '';
}

export function changeTextarea(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

export function changeInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Activates the named tab trigger. Radix's `Tabs.Trigger` switches on
 * `mousedown` (button 0), not `click` — the same quirk already noted for
 * `DropdownMenuTrigger` in AppShell.test.tsx — so a plain `.click()` (a
 * synthetic "click" event only) never triggers it in jsdom. Callers wrap
 * this in `act()`, matching every other interaction in this suite.
 */
export function switchJobOrderTab(container: HTMLElement, tab: JobOrderTabLabel): void {
  const trigger = Array.from(container.querySelectorAll('[role="tab"]')).find(
    (element) => element.textContent === tab,
  ) as HTMLElement | undefined;
  if (!trigger) throw new Error(`Tab trigger not found: ${tab}`);
  trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
}

/** The one tab panel Radix currently marks active — panels stay mounted (forceMount) so `container.textContent` alone can't distinguish active from inactive content. */
export function getActiveTabPanel(container: HTMLElement): HTMLElement {
  const panel = container.querySelector('[role="tabpanel"][data-state="active"]') as HTMLElement | null;
  if (!panel) throw new Error('No active tab panel found');
  return panel;
}
