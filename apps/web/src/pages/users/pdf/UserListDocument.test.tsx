import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { UserListDocument } from './UserListDocument.js';
import type { UserListPdfRow, UserListPdfViewModel } from './buildUserListViewModel.js';

function makeRow(overrides: Partial<UserListPdfRow> = {}): UserListPdfRow {
  return {
    id: 'user-1',
    name: 'Jane Doe',
    email: 'jane@erve.test',
    status: 'ACTIVE',
    roles: 'ADMIN',
    distributorName: null,
    factoryName: null,
    createdAt: '20 Aug 2026',
    ...overrides,
  };
}

function makeViewModel(rows: UserListPdfRow[]): UserListPdfViewModel {
  return {
    title: 'USER MASTER LIST',
    subtitle: 'Application users, roles, and organization mappings',
    filters: [
      { label: 'Search', value: '' },
      { label: 'Status', value: '' },
      { label: 'Role', value: '' },
    ],
    generatedAt: '2026-09-12T10:00:00Z',
    generatedBy: 'Test Admin',
    totalCount: rows.length,
    rows,
  };
}

describe('UserListDocument', () => {
  it('renders with zero rows without throwing', async () => {
    const blob = await pdf(<UserListDocument viewModel={makeViewModel([])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders a single row without throwing', async () => {
    const blob = await pdf(<UserListDocument viewModel={makeViewModel([makeRow()])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders null distributor/factory names as an em dash without throwing', async () => {
    const rows = [makeRow({ distributorName: null, factoryName: null })];
    const blob = await pdf(<UserListDocument viewModel={makeViewModel(rows)} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many rows (multi-page) without throwing', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => makeRow({ id: `user-${i}`, email: `user${i}@erve.test` }));
    const blob = await pdf(<UserListDocument viewModel={makeViewModel(rows)} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });
});
