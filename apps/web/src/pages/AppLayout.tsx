import { Outlet } from 'react-router-dom';
import {
  ClipboardList,
  Factory,
  Hammer,
  Handshake,
  LayoutDashboard,
  Ruler,
  Shirt,
  Tags,
  Users,
  Workflow,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext.js';
import { AppShell, type AppShellNavSection } from './AppShell.js';
import {
  canManageProcessFlows,
  canManageSizes,
  canManageUsers,
  canViewDistributorMaster,
  canViewFactories,
  canNavigateToJobOrders,
  canViewPriceLists,
  canViewPurchaseOrders,
  canViewQa,
  canViewStyles,
} from '../auth/permissions.js';

export function AppLayout() {
  const { user } = useAuth();

  const rawNavSections: AppShellNavSection[] = [
    {
      items: [{ to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }],
    },
    {
      heading: 'Master Data',
      items: [
        ...(canViewStyles(user) ? [{ to: '/master-data/styles', label: 'Styles', icon: Shirt }] : []),
        ...(canManageSizes(user) ? [{ to: '/master-data/sizes', label: 'Sizes', icon: Ruler }] : []),
        ...(canViewFactories(user)
          ? [{ to: '/master-data/factories', label: 'Factories', icon: Factory }]
          : []),
        ...(canViewDistributorMaster(user)
          ? [{ to: '/master-data/distributors', label: 'Distributors', icon: Handshake }]
          : []),
        ...(canManageProcessFlows(user)
          ? [{ to: '/master-data/process-flows', label: 'Process Flows', icon: Workflow }]
          : []),
        ...(canViewPriceLists(user) ? [{ to: '/price-lists', label: 'Price Lists', icon: Tags }] : []),
        ...(canManageUsers(user) ? [{ to: '/master-data/users', label: 'Users', icon: Users }] : []),
      ],
    },
    {
      heading: 'Orders',
      items: [
        ...(canViewPurchaseOrders(user)
          ? [{ to: '/purchase-orders', label: 'Purchase Orders', end: true, icon: ClipboardList }]
          : []),
        ...(canNavigateToJobOrders(user)
          ? [{ to: '/job-orders', label: 'Job Orders', icon: Hammer }]
          : []),
        ...(canViewQa(user)
          ? [{ to: '/qa', label: 'QA', icon: ShieldCheck }]
          : []),
      ],
    },
  ];

  const navSections = rawNavSections.filter((section) => section.items.length > 0);

  return (
    <AppShell navSections={navSections}>
      <Outlet />
    </AppShell>
  );
}
