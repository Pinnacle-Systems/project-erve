/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../../../lib/api-client.js';
import { content, getActiveTabPanel, renderJobOrderDetail } from '../test-utils.js';
import { draftOverrides, standardStages, styleLookup } from '../fixtures.js';

const authState = vi.hoisted(() => ({ roles: ['MERCHANDISER', 'FACTORY_USER'] }));

vi.mock('../../../../auth/AuthContext.js', () => ({
  useOptionalAuth: () => ({ user: { roles: authState.roles } }),
}));

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  authState.roles = ['MERCHANDISER', 'FACTORY_USER'];
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

describe('JobOrderOverviewTab', () => {
  it('shows the Job Order identity summary and Source Order Sheets on the default (Overview) tab, not Production/Quality content', async () => {
    await renderJobOrderDetail(container, root, { status: 'IN_PRODUCTION', stages: standardStages });

    const panel = getActiveTabPanel(container);
    expect(panel.textContent).toContain('Lifecycle');
    expect(panel.textContent).toContain('Ordered Qty');
    expect(panel.textContent).not.toContain('Current Stage:');
    expect(panel.textContent).not.toContain('Quality activities');
  });

  it('removing a source sends a bare orderSheetId list, never per-source quantities', async () => {
    // Two sources so Remove isn't disabled (a Job Order must retain at least one).
    await renderJobOrderDetail(container, root, {
      status: 'DRAFT',
      stages: standardStages,
      overrides: {
        ...draftOverrides,
        sourceOrderSheets: [
          ...draftOverrides.sourceOrderSheets,
          {
            id: 'os-2',
            poNumber: 'EIOS/26-27/0002',
            distributor: { id: 'd2', code: 'D2', name: 'XYZ Distributors' },
            purchaseMode: 'OUTRIGHT',
            requiredDeliveryDate: null,
            forecastTotal: 15,
          },
        ],
        sourceOrderSheetCount: 2,
      },
      extraGetResponses: { '/styles/style-1': styleLookup },
    });
    await vi.waitFor(() => expect(content(container)).toContain('EIOS/26-27/0002'));

    vi.spyOn(apiClient, 'patch').mockResolvedValue({
      data: { data: { ...draftOverrides, status: 'DRAFT' } },
    } as never);

    const removeButtons = Array.from(container.querySelectorAll('button')).filter(
      (button) => button.textContent === 'Remove',
    );
    expect(removeButtons).toHaveLength(2);
    act(() => removeButtons[0]!.click());
    await vi.waitFor(() => expect(apiClient.patch).toHaveBeenCalled());

    const [url, body] = vi.mocked(apiClient.patch).mock.calls[0]!;
    expect(url).toBe('/job-orders/jo-1/sources');
    // Bare orderSheetId list — no `sizes` anywhere in the payload (Phase
    // 2.1: source mapping is pure planning provenance).
    expect(body).toMatchObject({ add: [], remove: ['os-1'], expectedVersion: 1 });
    expect(JSON.stringify(body)).not.toContain('sizes');
  });
});
