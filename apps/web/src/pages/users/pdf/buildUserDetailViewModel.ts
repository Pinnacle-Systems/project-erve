import type { PdfKeyValueItem } from '../../../lib/pdf/core/PdfKeyValueSection.js';
import { formatPdfDateTime } from '../../../lib/pdf/format.js';
import type { AdminUserSummary } from '../../master-data/types.js';

export interface UserDetailPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface UserDetailPdfViewModel {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy?: string | null;
  identityItems: PdfKeyValueItem[];
}

/**
 * Pure, synchronous, no HTTP — maps the already-loaded User record + meta into the User Detail
 * PDF's view model.
 *
 * SECURITY: this is a field-by-field allowlist, never `...user`. AdminUserSummary itself never
 * carries password/token material (see users.service.ts's explicit toUserView mapper, which reads
 * only id/name/email/mobile/status/roles/distributors/factories/createdAt/updatedAt from the
 * database row), but this mapping is kept explicit as defense in depth — a fixture or future API
 * field the caller wasn't expecting cannot silently reach the printed document.
 */
export function buildUserDetailViewModel(
  user: AdminUserSummary,
  meta: UserDetailPdfMeta,
): UserDetailPdfViewModel {
  return {
    title: 'USER MASTER',
    subtitle: `${user.name} — ${user.email}`,
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    identityItems: [
      { label: 'Name', value: user.name },
      { label: 'Email', value: user.email },
      { label: 'Mobile', value: user.mobile },
      { label: 'Status', value: user.status },
      { label: 'Roles', value: user.roles.join(', ') },
      { label: 'Distributor', value: user.distributors[0]?.name },
      { label: 'Factory', value: user.factories[0]?.name },
      { label: 'Created', value: formatPdfDateTime(user.createdAt) },
      { label: 'Updated', value: formatPdfDateTime(user.updatedAt) },
    ],
  };
}
