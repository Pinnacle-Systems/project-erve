import { buildUserDetailViewModel, type UserDetailPdfMeta } from './buildUserDetailViewModel.js';
import { UserDetailDocument } from './UserDetailDocument.js';
import { renderPdfBlob } from '../../../lib/pdf/generate.js';
import type { AdminUserSummary } from '../../master-data/types.js';

/**
 * The only static importer of `UserDetailDocument` (and therefore of `@react-pdf/renderer` for
 * the User detail PDF). Callers reach this module via a dynamic `import()` so the PDF engine and
 * document code load only when a user actually clicks Download/Print.
 */
export async function generateUserDetailPdfBlob(
  user: AdminUserSummary,
  meta: UserDetailPdfMeta,
): Promise<Blob> {
  const viewModel = buildUserDetailViewModel(user, meta);
  return renderPdfBlob(<UserDetailDocument viewModel={viewModel} />);
}
