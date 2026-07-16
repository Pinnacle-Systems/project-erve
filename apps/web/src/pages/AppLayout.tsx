import { Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';
import { AppShell, type AppShellNavSection } from './AppShell.js';

export function AppLayout() {
  const { user } = useAuth();

  const canManagePOs = user?.roles.some((r) => ['ADMIN', 'MERCHANDISER', 'DISTRIBUTOR'].includes(r)) ?? false;
  const canManageMasterData = user?.roles.some((r) => ['ADMIN', 'MERCHANDISER'].includes(r)) ?? false;
  const canViewStyles = user?.roles.some((r) => ['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT'].includes(r)) ?? false;
  const canViewFactories = user?.roles.some((r) => ['ADMIN', 'MERCHANDISER', 'FACTORY_USER'].includes(r)) ?? false;
  const canViewJobOrders = user?.roles.some((r) =>
    ['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT', 'FACTORY_USER', 'QA_USER'].includes(r),
  ) ?? false;

  const navSections: AppShellNavSection[] = [
    {
      items: [{ to: '/dashboard', label: 'Dashboard' }],
    },
    {
      heading: 'Master Data',
      items: [
        ...(canViewStyles ? [{ to: '/master-data/styles', label: 'Styles' }] : []),
        ...(canManageMasterData ? [{ to: '/master-data/sizes', label: 'Sizes' }] : []),
        ...(canViewFactories ? [{ to: '/master-data/factories', label: 'Factories' }] : []),
        ...(canManageMasterData ? [{ to: '/master-data/process-flows', label: 'Process Flows' }] : []),
      ],
    },
    {
      heading: 'Orders',
      items: [
        { to: '/purchase-orders', label: 'Purchase Orders', end: true },
        ...(canManagePOs ? [{ to: '/purchase-orders/new', label: '+ New PO' }] : []),
        ...(canViewJobOrders ? [{ to: '/job-orders', label: 'Job Orders' }] : []),
      ],
    },
  ];

  return (
    <AppShell navSections={navSections}>
      <Outlet />
    </AppShell>
  );
}
