import { Outlet } from 'react-router-dom';
import {
  ClipboardList,
  CalendarRange,
  Factory,
  FileText,
  Hammer,
  Handshake,
  LayoutDashboard,
  PackageCheck,
  Receipt,
  RotateCcw,
  Ruler,
  Shirt,
  ShoppingCart,
  Tags,
  Truck,
  Undo2,
  Users,
  Workflow,
  ClipboardCheck,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext.js';
import { AppShell, type AppShellNavSection } from './AppShell.js';
import {
  canManageProcessFlows,
  canManageQualityForms,
  canManageSizes,
  canManageSeasons,
  canManageUsers,
  canViewDistributorMaster,
  canViewErveDispatches,
  canViewErvePackingLists,
  canViewFactories,
  canViewFactoryDispatches,
  canViewInvoiceHandoffs,
  canViewSaleOrReturnPositions,
  canViewDistributorSalesReports,
  canNavigateToJobOrders,
  canViewPriceLists,
  canViewPurchaseOrders,
  canViewSaleOrders,
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
        ...(canViewStyles(user)
          ? [{ to: '/master-data/styles', label: 'Styles', icon: Shirt }]
          : []),
        ...(canManageSeasons(user)
          ? [{ to: '/master-data/seasons', label: 'Seasons', icon: CalendarRange }]
          : []),
        ...(canManageSizes(user)
          ? [{ to: '/master-data/sizes', label: 'Sizes', icon: Ruler }]
          : []),
        ...(canViewFactories(user)
          ? [{ to: '/master-data/factories', label: 'Factories', icon: Factory }]
          : []),
        ...(canViewDistributorMaster(user)
          ? [{ to: '/master-data/distributors', label: 'Distributors', icon: Handshake }]
          : []),
        ...(canManageProcessFlows(user)
          ? [{ to: '/master-data/process-flows', label: 'Process Flows', icon: Workflow }]
          : []),
        ...(canManageQualityForms(user)
          ? [{ to: '/master-data/quality-forms', label: 'Quality Forms', icon: ClipboardCheck }]
          : []),
        ...(canViewPriceLists(user)
          ? [{ to: '/price-lists', label: 'Price Lists', icon: Tags }]
          : []),
        ...(canManageUsers(user)
          ? [{ to: '/master-data/users', label: 'Users', icon: Users }]
          : []),
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
        ...(canViewSaleOrders(user)
          ? [{ to: '/sale-orders', label: 'Sale Orders', icon: ShoppingCart }]
          : []),
      ],
    },
    {
      heading: 'Fulfillment',
      items: [
        ...(canViewFactoryDispatches(user)
          ? [{ to: '/fulfillment/factory-dispatches', label: 'Factory Packing', icon: PackageCheck }]
          : []),
        ...(canViewErvePackingLists(user)
          ? [{ to: '/fulfillment/erve-packing-lists', label: 'Erve Packing Lists', icon: PackageCheck }]
          : []),
        ...(canViewErveDispatches(user)
          ? [{ to: '/fulfillment/erve-dispatches', label: 'Dispatches', icon: Truck }]
          : []),
        ...(canViewInvoiceHandoffs(user)
          ? [{ to: '/fulfillment/invoices', label: 'Invoices', icon: Receipt }]
          : []),
        ...(canViewSaleOrReturnPositions(user)
          ? [{ to: '/fulfillment/sale-or-return', label: 'Sale-or-Return Stock', icon: RotateCcw }]
          : []),
        ...(canViewSaleOrReturnPositions(user)
          ? [{ to: '/fulfillment/distributor-returns', label: 'Distributor Returns', icon: Undo2 }]
          : []),
        ...(canViewDistributorSalesReports(user)
          ? [{ to: '/fulfillment/distributor-sales-reports', label: 'Sales Reports', icon: FileText }]
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
