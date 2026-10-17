/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthUser, Role } from '@erve/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { GstRuleSetDetailPage } from './GstRuleSetDetailPage.js';
import type { GstRuleSet, GstRuleSetVersion } from '../master-data/types.js';

let container: HTMLDivElement;
let root: Root;
const originalTZ = process.env.TZ;

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
  vi.useRealTimers();
  process.env.TZ = originalTZ;
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return;
    await act(async () => {
      await flushMicrotasks();
    });
  }
  throw new Error(message);
}

function buildRuleSet(): GstRuleSet {
  return {
    id: 'rs-1',
    code: 'GST-GARMENT-STD',
    name: 'Garment GST — Standard',
    status: 'ACTIVE',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    versions: [
      {
        id: 'v2',
        versionNumber: 2,
        status: 'DRAFT',
        effectiveFrom: null,
        effectiveTo: null,
        bands: [],
        createdAt: '2024-06-01T00:00:00.000Z',
        updatedAt: '2024-06-01T00:00:00.000Z',
      },
      {
        id: 'v1',
        versionNumber: 1,
        status: 'ACTIVE',
        effectiveFrom: '2017-07-01',
        effectiveTo: null,
        bands: [
          { id: 'b1', minValue: null, maxValue: 2500, gstPercent: 5 },
          { id: 'b2', minValue: 2500, maxValue: null, gstPercent: 18 },
        ],
        createdAt: '2017-07-01T00:00:00.000Z',
        updatedAt: '2017-07-01T00:00:00.000Z',
      },
    ],
  };
}

function mockUser(role: Role) {
  const user: AuthUser = { id: 'user-1', email: 'test@test.local', mobile: null, name: 'Test User', roles: [role] };
  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    user,
    token: 'valid-token',
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    isInitializing: false,
  } as unknown as ReturnType<typeof AuthContext.useAuth>);
}

async function renderPage(ruleSet: GstRuleSet, role: Role = 'ADMIN') {
  mockUser(role);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === `/gst-rule-sets/${ruleSet.id}`) {
      return { data: { data: ruleSet } };
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[`/gst-rule-sets/${ruleSet.id}`]}>
          <Routes>
            <Route path="/gst-rule-sets/:id" element={<GstRuleSetDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await waitFor(() => !container.textContent?.includes('Loading GST Rule Set'), 'timed out waiting for loading to clear');
}

describe('GstRuleSetDetailPage', () => {
  it('renders the rule set header and both versions', async () => {
    await renderPage(buildRuleSet());
    expect(container.textContent).toContain('GST-GARMENT-STD');
    expect(container.textContent).toContain('Garment GST — Standard');
    expect(container.textContent).toContain('v1');
    expect(container.textContent).toContain('v2');
  });

  it('defaults to showing the first (highest-numbered) version\'s bands', async () => {
    await renderPage(buildRuleSet());
    // v2 (the DRAFT, listed first by the API's desc-by-versionNumber order)
    // has no bands yet.
    expect(container.textContent).toContain('Value Bands — v2');
    expect(container.textContent).toContain('No value bands yet');
  });

  it('switches to a different version\'s bands when its row is clicked', async () => {
    await renderPage(buildRuleSet());
    const v1Link = Array.from(container.querySelectorAll('button')).find((el) => el.textContent === 'v1');
    expect(v1Link).toBeTruthy();
    act(() => {
      v1Link!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => container.textContent?.includes('Value Bands — v1') ?? false, 'did not switch to v1 bands');
    expect(container.textContent).toContain('≤ 2,500');
    expect(container.textContent).toContain('5%');
    expect(container.textContent).toContain('> 2,500');
    expect(container.textContent).toContain('18%');
  });

  it('shows Activate only for a DRAFT version, and only when the user can manage', async () => {
    await renderPage(buildRuleSet(), 'ADMIN');
    let buttons = Array.from(container.querySelectorAll('button')).map((el) => el.textContent);
    // v2 (DRAFT) is the default selection/first row — Activate must be offered for it.
    expect(buttons).toContain('Activate');

    await renderPage(buildRuleSet(), 'SENIOR_MANAGEMENT');
    buttons = Array.from(container.querySelectorAll('button')).map((el) => el.textContent);
    expect(buttons).not.toContain('Activate');
  });

  it('warns when the master is ACTIVE but no ACTIVE version is effective today', async () => {
    const draftOnly = buildRuleSet();
    draftOnly.versions = draftOnly.versions.filter((version) => version.status === 'DRAFT');
    await renderPage(draftOnly, 'ACCOUNTANT');
    expect(container.textContent).toContain('GST Rule Set master: ACTIVE');
    expect(container.textContent).toContain('No ACTIVE version\'s effective window covers today.');
    expect(container.textContent).toContain('Set dates and activate an eligible version.');
    expect(Array.from(container.querySelectorAll('button')).map((button) => button.textContent))
      .toContain('Edit Dates');
  });

  it('preloads a draft window, submits the existing PATCH endpoint with unchanged identity, and keeps ACTIVE versions locked', async () => {
    const ruleSet = buildRuleSet();
    ruleSet.versions[0]!.effectiveFrom = '2026-11-01';
    ruleSet.versions[0]!.effectiveTo = '2026-11-30';
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: { data: ruleSet } });
    await renderPage(ruleSet, 'ACCOUNTANT');
    const editButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Edit Dates');
    expect(editButton).toBeDefined();
    act(() => editButton!.click());
    const dateForm = Array.from(container.querySelectorAll('form')).find((form) =>
      form.textContent?.includes('Save Dates'));
    expect(dateForm).toBeDefined();
    const dates = Array.from(dateForm!.querySelectorAll('input[type="text"]')) as HTMLInputElement[];
    expect(dates).toHaveLength(2);
    expect(dates[0]?.value).toBe('01/11/2026');
    expect(dates[1]?.value).toBe('30/11/2026');
    const save = Array.from(dateForm!.querySelectorAll('button')).find((b) => b.textContent === 'Save Dates');
    await act(async () => { save!.click(); await flushMicrotasks(); });
    await waitFor(() => patch.mock.calls.length === 1, 'date update PATCH was not sent');
    expect(patch).toHaveBeenCalledWith('/gst-rule-sets/rs-1/versions/v2', {
      effectiveFrom: '2026-11-01',
      effectiveTo: '2026-11-30',
    });
    const v1Link = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'v1');
    act(() => v1Link!.click());
    expect(container.textContent).toContain('Value Bands — v1');
    expect(container.textContent).not.toContain('Edit Effective Dates — v1');
  });

  it('never offers the date mutation controls to read-only roles', async () => {
    await renderPage(buildRuleSet(), 'SENIOR_MANAGEMENT');
    const buttons = Array.from(container.querySelectorAll('button')).map((el) => el.textContent);
    expect(buttons).not.toContain('Edit Dates');
    expect(buttons).not.toContain('Save Dates');
  });

  // -------------------------------------------------------------------------
  // A. Master status vs. effective-version semantics (ISS-029 correction).
  // The backend resolver (resolveGstRuleForHsn) never filters on the GST
  // Rule Set master's status — only on the version's own ACTIVE status and
  // effective window. These tests pin the business date so "today" is
  // deterministic, then exercise every master/version combination.
  // -------------------------------------------------------------------------
  describe('master status vs. effective version', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      // 10:00 UTC = 15:30 IST — safely mid-day, no boundary ambiguity.
      vi.setSystemTime(new Date('2026-10-17T10:00:00.000Z'));
    });

    function versionCoveringToday(overrides: Partial<GstRuleSetVersion> = {}): GstRuleSetVersion {
      return {
        id: 'v-active',
        versionNumber: 3,
        status: 'ACTIVE',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        bands: [{ id: 'b1', minValue: null, maxValue: null, gstPercent: 5 }],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
      };
    }

    it('ACTIVE master with an effective ACTIVE version: reports the effective version plainly', async () => {
      const ruleSet = buildRuleSet();
      ruleSet.status = 'ACTIVE';
      ruleSet.versions = [versionCoveringToday()];
      await renderPage(ruleSet, 'SENIOR_MANAGEMENT');
      expect(container.textContent).toContain('GST Rule Set master: ACTIVE');
      expect(container.textContent).toContain('Effective version today: v3.');
      expect(container.textContent).not.toContain('Not applicable');
    });

    it('ACTIVE master with only DRAFT versions: reports no effective version, independent of master', async () => {
      const ruleSet = buildRuleSet();
      ruleSet.status = 'ACTIVE';
      ruleSet.versions = [versionCoveringToday({ status: 'DRAFT' })];
      await renderPage(ruleSet, 'SENIOR_MANAGEMENT');
      expect(container.textContent).toContain('No ACTIVE version\'s effective window covers today.');
    });

    it('INACTIVE master with an effective ACTIVE version: uses neutral configuration wording, never "not applicable"', async () => {
      const ruleSet = buildRuleSet();
      ruleSet.status = 'INACTIVE';
      ruleSet.versions = [versionCoveringToday()];
      await renderPage(ruleSet, 'SENIOR_MANAGEMENT');
      expect(container.textContent).toContain('GST Rule Set master: INACTIVE');
      expect(container.textContent).toContain(
        'Configuration note: v3 is ACTIVE and its effective window covers today, though the master is INACTIVE.',
      );
      expect(container.textContent).not.toContain('Not applicable');
      expect(container.textContent).not.toContain('master inactive');
    });

    it('INACTIVE master with no effective ACTIVE version: reports the absence on its own terms', async () => {
      const ruleSet = buildRuleSet();
      ruleSet.status = 'INACTIVE';
      ruleSet.versions = [versionCoveringToday({ status: 'DRAFT' })];
      await renderPage(ruleSet, 'SENIOR_MANAGEMENT');
      expect(container.textContent).toContain('GST Rule Set master: INACTIVE');
      expect(container.textContent).toContain('No ACTIVE version\'s effective window covers today.');
      expect(container.textContent).not.toContain('Not applicable');
    });

    it('a future-dated ACTIVE version is not treated as effective today', async () => {
      const ruleSet = buildRuleSet();
      ruleSet.status = 'ACTIVE';
      ruleSet.versions = [versionCoveringToday({ effectiveFrom: '2027-01-01', effectiveTo: null })];
      await renderPage(ruleSet, 'SENIOR_MANAGEMENT');
      expect(container.textContent).toContain('No ACTIVE version\'s effective window covers today.');
    });

    it('an expired ACTIVE version (effectiveTo in the past) is not treated as effective today', async () => {
      const ruleSet = buildRuleSet();
      ruleSet.status = 'ACTIVE';
      ruleSet.versions = [
        versionCoveringToday({ effectiveFrom: '2020-01-01', effectiveTo: '2021-12-31', status: 'EXPIRED' }),
      ];
      await renderPage(ruleSet, 'SENIOR_MANAGEMENT');
      expect(container.textContent).toContain('No ACTIVE version\'s effective window covers today.');
    });

    it('gives read-only roles informational text with no action instruction', async () => {
      const ruleSet = buildRuleSet();
      ruleSet.status = 'ACTIVE';
      ruleSet.versions = [versionCoveringToday({ status: 'DRAFT' })];
      await renderPage(ruleSet, 'SENIOR_MANAGEMENT');
      expect(container.textContent).toContain('No ACTIVE version\'s effective window covers today.');
      expect(container.textContent).not.toContain('Set dates and activate an eligible version.');
    });

    it('gives ADMIN/ACCOUNTANT the actionable follow-up when nothing is effective', async () => {
      const ruleSet = buildRuleSet();
      ruleSet.status = 'ACTIVE';
      ruleSet.versions = [versionCoveringToday({ status: 'DRAFT' })];
      await renderPage(ruleSet, 'ACCOUNTANT');
      expect(container.textContent).toContain('Set dates and activate an eligible version.');
    });
  });

  // -------------------------------------------------------------------------
  // B. Business timezone (Asia/Kolkata), independent of the browser's own
  // timezone — verifying the rendered "ERVE business date" text, not just
  // the underlying helper.
  // -------------------------------------------------------------------------
  describe('ERVE business date display', () => {
    afterEach(() => {
      vi.useRealTimers();
      process.env.TZ = originalTZ;
    });

    it('shows the Asia/Kolkata business date when the browser timezone is UTC', async () => {
      process.env.TZ = 'UTC';
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(new Date('2026-10-17T19:00:00.000Z')); // 00:30 IST on Oct 18
      const ruleSet = buildRuleSet();
      await renderPage(ruleSet, 'SENIOR_MANAGEMENT');
      expect(container.textContent).toContain('ERVE business date: 2026-10-18.');
    });

    it('shows the same Asia/Kolkata business date when the browser timezone is far from IST', async () => {
      process.env.TZ = 'America/Los_Angeles';
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(new Date('2026-10-17T19:00:00.000Z'));
      const ruleSet = buildRuleSet();
      await renderPage(ruleSet, 'SENIOR_MANAGEMENT');
      expect(container.textContent).toContain('ERVE business date: 2026-10-18.');
    });

    it('updates the displayed business date and effective version across the midnight boundary while mounted', async () => {
      process.env.TZ = 'UTC';
      vi.useFakeTimers({ shouldAdvanceTime: true });
      // 18:00 UTC on Oct 17 = 23:30 IST on Oct 17 — 30 min before the boundary.
      vi.setSystemTime(new Date('2026-10-17T18:00:00.000Z'));
      const ruleSet = buildRuleSet();
      ruleSet.status = 'ACTIVE';
      ruleSet.versions = [
        {
          id: 'v-boundary',
          versionNumber: 5,
          status: 'ACTIVE',
          effectiveFrom: '2026-10-18',
          effectiveTo: null,
          bands: [{ id: 'b1', minValue: null, maxValue: null, gstPercent: 5 }],
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
        },
      ];
      await renderPage(ruleSet, 'SENIOR_MANAGEMENT');
      expect(container.textContent).toContain('ERVE business date: 2026-10-17.');
      expect(container.textContent).toContain('No ACTIVE version\'s effective window covers today.');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1000); // cross 18:30 UTC
      });

      expect(container.textContent).toContain('ERVE business date: 2026-10-18.');
      expect(container.textContent).toContain('Effective version today: v5.');
    });

    it('rechecks the business date when the tab regains visibility', async () => {
      process.env.TZ = 'UTC';
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(new Date('2026-10-17T18:00:00.000Z'));
      const ruleSet = buildRuleSet();
      await renderPage(ruleSet, 'SENIOR_MANAGEMENT');
      expect(container.textContent).toContain('ERVE business date: 2026-10-17.');

      vi.setSystemTime(new Date('2026-10-17T19:00:00.000Z')); // past the boundary, timer never fired
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });

      expect(container.textContent).toContain('ERVE business date: 2026-10-18.');
    });
  });

  // -------------------------------------------------------------------------
  // C. Role and mutation safety.
  // -------------------------------------------------------------------------
  describe('role and mutation safety', () => {
    it('never offers Edit Dates for an EXPIRED version', async () => {
      const ruleSet = buildRuleSet();
      ruleSet.versions.push({
        id: 'v-expired',
        versionNumber: 0,
        status: 'EXPIRED',
        effectiveFrom: '2015-01-01',
        effectiveTo: '2017-06-30',
        bands: [],
        createdAt: '2015-01-01T00:00:00.000Z',
        updatedAt: '2015-01-01T00:00:00.000Z',
      });
      await renderPage(ruleSet, 'ADMIN');
      const expiredRow = Array.from(container.querySelectorAll('tr')).find((row) => row.textContent?.includes('EXPIRED'));
      expect(expiredRow).toBeDefined();
      const rowButtonLabels = Array.from(expiredRow!.querySelectorAll('button')).map((b) => b.textContent);
      expect(rowButtonLabels).not.toContain('Edit Dates');
      expect(rowButtonLabels).not.toContain('Activate');
      expect(rowButtonLabels).not.toContain('Delete');
    });

    function typeIntoInput(input: HTMLInputElement, text: string) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      act(() => {
        input.focus();
        setter.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }

    it('shows a readable client-side validation message for Effective To without Effective From', async () => {
      const ruleSet = buildRuleSet();
      ruleSet.versions[0]!.effectiveFrom = null;
      ruleSet.versions[0]!.effectiveTo = null;
      await renderPage(ruleSet, 'ADMIN');
      const editButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Edit Dates');
      act(() => editButton!.click());
      const dateForm = Array.from(container.querySelectorAll('form')).find((form) =>
        form.textContent?.includes('Save Dates'));
      const effectiveToInput = Array.from(dateForm!.querySelectorAll('input[type="text"]'))[1] as HTMLInputElement;
      typeIntoInput(effectiveToInput, '30/11/2026');

      const save = Array.from(dateForm!.querySelectorAll('button')).find((b) => b.textContent === 'Save Dates');
      await act(async () => { save!.click(); await flushMicrotasks(); });
      await waitFor(
        () => container.textContent?.includes('Effective To requires Effective From.') ?? false,
        'validation message did not appear',
      );
    });
  });
});
