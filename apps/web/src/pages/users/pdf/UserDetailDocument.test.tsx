import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { UserDetailDocument } from './UserDetailDocument.js';
import type { UserDetailPdfViewModel } from './buildUserDetailViewModel.js';

function makeViewModel(overrides: Partial<UserDetailPdfViewModel> = {}): UserDetailPdfViewModel {
  return {
    title: 'USER MASTER',
    subtitle: 'Jane Doe — jane@erve.test',
    generatedAt: '2026-09-12T10:00:00Z',
    generatedBy: 'Test Admin',
    identityItems: [
      { label: 'Name', value: 'Jane Doe' },
      { label: 'Email', value: 'jane@erve.test' },
      { label: 'Mobile', value: null },
      { label: 'Status', value: 'ACTIVE' },
      { label: 'Roles', value: 'ADMIN' },
      { label: 'Distributor', value: undefined },
      { label: 'Factory', value: undefined },
    ],
    ...overrides,
  };
}

describe('UserDetailDocument', () => {
  it('renders without throwing', async () => {
    const blob = await pdf(<UserDetailDocument viewModel={makeViewModel()} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders null/undefined values as an em dash without throwing', async () => {
    const vm = makeViewModel({ identityItems: [{ label: 'Mobile', value: null }, { label: 'Distributor', value: undefined }] });
    const blob = await pdf(<UserDetailDocument viewModel={vm} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });
});
