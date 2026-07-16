import { Outlet } from 'react-router-dom';
import { CirclePlus, ClipboardList, Factory, Hammer, LayoutDashboard, Ruler, Shirt, Workflow } from 'lucide-react';
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
      items: [{ to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }],
    },
    {
      heading: 'Master Data',
      items: [
        ...(canViewStyles ? [{ to: '/master-data/styles', label: 'Styles', icon: Shirt }] : []),
        ...(canManageMasterData ? [{ to: '/master-data/sizes', label: 'Sizes', icon: Ruler }] : []),
        ...(canViewFactories ? [{ to: '/master-data/factories', label: 'Factories', icon: Factory }] : []),
        ...(canManageMasterData
          ? [{ to: '/master-data/process-flows', label: 'Process Flows', icon: Workflow }]
          : []),
      ],
    },
    {
      heading: 'Orders',
      items: [
        { to: '/purchase-orders', label: 'Purchase Orders', end: true, icon: ClipboardList },
        ...(canManagePOs ? [{ to: '/purchase-orders/new', label: '+ New PO', icon: CirclePlus }] : []),
        ...(canViewJobOrders ? [{ to: '/job-orders', label: 'Job Orders', icon: Hammer }] : []),
      ],
    },
  ];

  return (
    <AppShell navSections={navSections}>
      <Outlet />
    </AppShell>
  );
}
