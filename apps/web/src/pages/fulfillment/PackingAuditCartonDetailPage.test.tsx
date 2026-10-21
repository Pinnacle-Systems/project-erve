/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, Role } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { PackingAuditCartonDetailPage } from './PackingAuditCartonDetailPage.js';
import type { PackingAuditQueueItem } from './types.js';

let container: HTMLDivElement;
let root: Root;

function mockAuth(role: Role) {
  const user: AuthUser = { id: 'user-1', email: 'user@test.local', mobile: null, name: 'Test User', roles: [role] };
  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    user,
    token: 'valid-token',
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    isInitializing: false,
  } as unknown as ReturnType<typeof AuthContext.useAuth>);
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const content = () => container.textContent ?? '';

function buildCarton(
  overrides: Partial<PackingAuditQueueItem & { factoryDispatchId: string }> = {},
): PackingAuditQueueItem & { factoryDispatchId: string } {
  return {
    id: 'carton-1',
    cartonNumber: 'C1',
    destinationId: 'dest-1',
    packageDetails: null,
    netWeight: null,
    grossWeight: null,
    dimensions: null,
    version: 1,
    totalQuantity: 10,
    destinationMismatch: false,
    auditState: 'NOT_INSPECTED',
    retired: false,
    retiredAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    lines: [
      {
        saleOrderLineId: 'line-1',
        styleId: 'style-1',
        styleNumber: 'ST-001',
        styleName: 'Classic Tee',
        primaryImage: null,
        sizeId: 'size-1',
        sizeCode: 'M',
        sizeLabel: 'Medium',
        quantity: 10,
        currentDestinationId: 'dest-1',
      },
    ],
    auditHistory: [],
    factoryDispatchNumber: 'EIFD/26-27/0001',
    factory: { id: 'fac-1', code: 'FAC1', name: 'Factory One' },
    saleOrder: { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001' },
    destination: {
      id: 'dest-1',
      label: null,
      city: 'Chennai',
      state: 'TN',
      distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' },
    },
    factoryDispatchId: 'fd-1',
    ...overrides,
  };
}

async function renderPage(getImpl: (url: string) => Promise<unknown>, role: Role = 'ADMIN') {
  mockAuth(role);
  vi.spyOn(apiClient, 'get').mockImplementation(getImpl as never);

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/fulfillment/packing-audit/cartons/carton-1']}>
          <Routes>
            <Route path="/fulfillment/packing-audit/cartons/:cartonId" element={<PackingAuditCartonDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(() => expect(content()).not.toContain('Loading carton'));
}

describe('PackingAuditCartonDetailPage load error handling (UXAUTH-018)', () => {
  it('shows an error state, not a not-found/empty state, when the request fails', async () => {
    await renderPage(async () => {
      throw new Error('Request failed with status code 500');
    });

    expect(content()).not.toContain('Carton not found');
    expect(content()).toContain('Unable to load carton');
    expect(content()).toContain('Request failed with status code 500');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('still renders the record normally when the request succeeds', async () => {
    const carton = buildCarton();
    await renderPage(async (url: string) => {
      if (url === '/packing-audit/cartons/carton-1') return { data: { data: carton } };
      throw new Error(`Unexpected GET: ${url}`);
    });

    expect(content()).toContain('Carton C1');
    expect(content()).toContain('EISO/26-27/0001');
    expect(content()).not.toContain('Unable to load carton');
  });
});

describe('BUG-005 Packing Audit carton destination context', () => {
  it.each(['ADMIN', 'QA_USER'] as const)(
    'shows the owning Distributor and destination to a %s reviewer without changing audit permission',
    async (role) => {
      const carton = buildCarton({
        destination: {
          id: 'dest-1',
          label: 'A Long Outlet Name That Must Remain Readable',
          city: 'Chennai',
          state: 'TN',
          distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' },
        },
      });
      await renderPage(async (url) => {
        if (url === '/packing-audit/cartons/carton-1') return { data: { data: carton } };
        throw new Error(`Unexpected GET: ${url}`);
      }, role);
      const fields = Array.from(container.querySelectorAll('.text-label')).map((e) => e.textContent?.trim());
      expect(fields).toContain('Distributor');
      expect(fields).toContain('Destination');
      expect(content()).toContain('Distributor One');
      expect(content()).toContain('A Long Outlet Name That Must Remain Readable · Chennai, TN');
      expect(content()).toContain('10');
      expect(content()).toContain('ST-001');
      expect(content().includes('Confirm Inspected')).toBe(role === 'QA_USER');
    },
  );

  it('uses actual city/state when destination label is not supplied', async () => {
    await renderPage(async (url) => {
      if (url === '/packing-audit/cartons/carton-1') return { data: { data: buildCarton() } };
      throw new Error(`Unexpected GET: ${url}`);
    });
    expect(content()).toContain('Distributor One');
    expect(content()).toContain('Chennai, TN');
    expect(content()).not.toContain('null');
  });
});

// ISS-023 Phase 2: the carton's own contents render as one Style row with
// Sizes as columns, rather than one flat row per Style+Size combination.
describe('PackingAuditCartonDetailPage carton Style x Size presentation (ISS-023 Phase 2)', () => {
  it('groups multiple Sizes of the same Style into a single row instead of repeating the Style', async () => {
    const carton = buildCarton({
      lines: [
        { saleOrderLineId: 'line-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: null, sizeId: 'size-1', sizeCode: 'S', sizeLabel: 'Small', quantity: 3, currentDestinationId: 'dest-1' },
        { saleOrderLineId: 'line-2', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: null, sizeId: 'size-2', sizeCode: 'M', sizeLabel: 'Medium', quantity: 4, currentDestinationId: 'dest-1' },
      ],
      totalQuantity: 7,
    });
    await renderPage(async (url) => {
      if (url === '/packing-audit/cartons/carton-1') return { data: { data: carton } };
      throw new Error(`Unexpected GET: ${url}`);
    });

    const styleCells = Array.from(container.querySelectorAll('td')).filter((td) => td.textContent?.includes('ST-001'));
    expect(styleCells).toHaveLength(1);
    expect(content()).toContain('S');
    expect(content()).toContain('M');
    // The row total (3+4) reconciles to the carton's own Total Quantity.
    expect(content()).toContain('7');
  });

  it('groups two different Styles into two separate rows, never merged by shared Size', async () => {
    const carton = buildCarton({
      lines: [
        { saleOrderLineId: 'line-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: null, sizeId: 'size-1', sizeCode: 'M', sizeLabel: 'Medium', quantity: 6, currentDestinationId: 'dest-1' },
        { saleOrderLineId: 'line-2', styleId: 'style-2', styleNumber: 'ST-002', styleName: 'Polo', primaryImage: null, sizeId: 'size-1', sizeCode: 'M', sizeLabel: 'Medium', quantity: 4, currentDestinationId: 'dest-1' },
      ],
      totalQuantity: 10,
    });
    await renderPage(async (url) => {
      if (url === '/packing-audit/cartons/carton-1') return { data: { data: carton } };
      throw new Error(`Unexpected GET: ${url}`);
    });

    expect(content()).toContain('ST-001');
    expect(content()).toContain('ST-002');
    // Two distinct rows, each with its own quantity, not summed into one "M" cell.
    expect(content()).toContain('6');
    expect(content()).toContain('4');
  });

  it('carries the Style primary image through to the matrix row (one Style, multiple Sizes)', async () => {
    const primaryImage = {
      id: 'img-1',
      styleId: 'style-1',
      fileId: 'file-1',
      fileName: 'classic-tee.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      isPrimary: true,
      sortOrder: 0,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    };
    const carton = buildCarton({
      lines: [
        { saleOrderLineId: 'line-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage, sizeId: 'size-1', sizeCode: 'S', sizeLabel: 'Small', quantity: 3, currentDestinationId: 'dest-1' },
        { saleOrderLineId: 'line-2', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage, sizeId: 'size-2', sizeCode: 'M', sizeLabel: 'Medium', quantity: 4, currentDestinationId: 'dest-1' },
      ],
      totalQuantity: 7,
    });
    await renderPage(async (url) => {
      if (url === '/packing-audit/cartons/carton-1') return { data: { data: carton } };
      throw new Error(`Unexpected GET: ${url}`);
    });

    // StyleThumbnailCell only renders its "View style image" trigger when passed a non-null image —
    // a single trigger (not one per source line) confirms the one-per-Style row carries it through.
    const thumbnailTriggers = container.querySelectorAll('button[aria-label="View style image"]');
    expect(thumbnailTriggers).toHaveLength(1);
  });

  it('renders no thumbnail trigger when the Style has no primary image', async () => {
    const carton = buildCarton({
      lines: [
        { saleOrderLineId: 'line-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: null, sizeId: 'size-1', sizeCode: 'M', sizeLabel: 'Medium', quantity: 5, currentDestinationId: 'dest-1' },
      ],
      totalQuantity: 5,
    });
    await renderPage(async (url) => {
      if (url === '/packing-audit/cartons/carton-1') return { data: { data: carton } };
      throw new Error(`Unexpected GET: ${url}`);
    });

    expect(container.querySelectorAll('button[aria-label="View style image"]')).toHaveLength(0);
  });
});

// NEW-AUTH: role-parametrized coverage for the Confirm Inspected mutation
// CTA (canConfirmPackingAudits — PACKING_AUDIT_MUTATION_ROLES, QA_USER
// only). Only ADMIN and QA_USER can even reach this page (route-level
// PACKING_AUDIT_VIEW_ROLES), and ADMIN is *deliberately excluded* from
// confirming — a segregation-of-duties choice ("FACTORY_USER packs, QA_USER
// audits") that's the opposite of this codebase's usual ADMIN-can-do-
// anything pattern, so it's tested explicitly rather than assumed. No
// runtime change: gating was already correct.
describe('PackingAuditCartonDetailPage Confirm Inspected mutation visibility by role', () => {
  async function renderCarton(role: Role, overrides: Partial<Parameters<typeof buildCarton>[0]> = {}) {
    const carton = buildCarton(overrides);
    await renderPage(async (url: string) => {
      if (url === '/packing-audit/cartons/carton-1') return { data: { data: carton } };
      throw new Error(`Unexpected GET: ${url}`);
    }, role);
  }

  it('QA_USER sees Confirm Inspected on a NOT_INSPECTED, non-retired carton', async () => {
    await renderCarton('QA_USER', { auditState: 'NOT_INSPECTED', retired: false });
    expect(content()).toContain('Confirm Inspected');
  });

  it('QA_USER sees Confirm Inspected on a NEEDS_REINSPECTION carton', async () => {
    await renderCarton('QA_USER', { auditState: 'NEEDS_REINSPECTION', retired: false });
    expect(content()).toContain('Confirm Inspected');
  });

  it('ADMIN can read the carton but never sees Confirm Inspected, even though ADMIN can view the queue', async () => {
    await renderCarton('ADMIN', { auditState: 'NOT_INSPECTED', retired: false });
    expect(content()).toContain('Carton C1');
    expect(content()).not.toContain('Confirm Inspected');
  });

  it('document-state gating: QA_USER loses Confirm Inspected once the carton is already INSPECTED (current state)', async () => {
    await renderCarton('QA_USER', { auditState: 'INSPECTED', retired: false });
    expect(content()).not.toContain('Confirm Inspected');
  });

  it('does not offer Confirm Inspected while carton destinations mismatch', async () => {
    await renderCarton('QA_USER', { auditState: 'NOT_INSPECTED', destinationMismatch: true });

    expect(content()).toContain('it must be reconciled by the Factory before it can be');
    expect(content()).not.toContain('Confirm Inspected');
  });

  it('does not offer reinspection confirmation when carton destinations mismatch', async () => {
    await renderCarton('QA_USER', { auditState: 'NEEDS_REINSPECTION', destinationMismatch: true });

    expect(content()).not.toContain('Confirm Inspected');
  });

  it('document-state gating: QA_USER loses Confirm Inspected on a retired carton', async () => {
    await renderCarton('QA_USER', { auditState: 'NOT_INSPECTED', retired: true, retiredAt: '2026-09-02T00:00:00.000Z' });
    expect(content()).not.toContain('Confirm Inspected');
  });
});
