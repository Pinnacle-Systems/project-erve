import {
  buildUserListViewModel,
  type UserListPdfFilters,
  type UserListPdfMeta,
} from './buildUserListViewModel.js';
import { UserListDocument } from './UserListDocument.js';
import { renderPdfBlob } from '../../../lib/pdf/generate.js';
import type { AdminUserSummary } from '../../master-data/types.js';

/**
 * The only static importer of `UserListDocument` (and therefore of `@react-pdf/renderer` for the
 * User list). Callers reach this module via a dynamic `import()` so the PDF engine and document
 * code load only when a user actually clicks Download/Print, not as part of the app's initial
 * bundle.
 */
export async function generateUserListPdfBlob(
  users: AdminUserSummary[],
  filters: UserListPdfFilters,
  meta: UserListPdfMeta,
): Promise<Blob> {
  const viewModel = buildUserListViewModel(users, filters, meta);
  return renderPdfBlob(<UserListDocument viewModel={viewModel} />);
}
