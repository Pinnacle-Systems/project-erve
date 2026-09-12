import { formatPdfDate } from '../../../lib/pdf/format.js';
import type { AdminUserSummary } from '../../master-data/types.js';

export interface UserListPdfFilters {
  search?: string;
  status?: string;
  role?: string;
}

export interface UserListPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface UserListPdfRow {
  id: string;
  name: string;
  email: string;
  status: string;
  roles: string;
  distributorName: string | null;
  factoryName: string | null;
  createdAt: string;
}

export interface UserListPdfViewModel {
  title: string;
  subtitle: string;
  filters: Array<{ label: string; value: string }>;
  generatedAt: string;
  generatedBy?: string | null;
  totalCount: number;
  rows: UserListPdfRow[];
}

/**
 * Pure, synchronous, no HTTP: maps the already-loaded list query data + filter/meta state into
 * the plain view-model UserListDocument renders. Row order is preserved as returned by the API
 * (its fixed default order); User has no user-facing sort control today.
 *
 * SECURITY: this is a field-by-field allowlist, never `...user`. AdminUserSummary itself never
 * carries password/token material (see users.service.ts's explicit toUserView mapper), but this
 * mapping is kept explicit as defense in depth — a fixture or future API field the caller wasn't
 * expecting cannot silently reach the printed document.
 */
export function buildUserListViewModel(
  users: AdminUserSummary[],
  filters: UserListPdfFilters,
  meta: UserListPdfMeta,
): UserListPdfViewModel {
  const rows: UserListPdfRow[] = users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    status: user.status,
    roles: user.roles.join(', '),
    distributorName: user.distributors[0]?.name ?? null,
    factoryName: user.factories[0]?.name ?? null,
    createdAt: formatPdfDate(user.createdAt),
  }));

  return {
    title: 'USER MASTER LIST',
    subtitle: 'Application users, roles, and organization mappings',
    filters: [
      { label: 'Search', value: filters.search ?? '' },
      { label: 'Status', value: filters.status ?? '' },
      { label: 'Role', value: filters.role ?? '' },
    ],
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    totalCount: rows.length,
    rows,
  };
}
