import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { Card } from '@erve/layout';
import { useAuth } from '../auth/AuthContext.js';
import {
  canNavigateToJobOrders,
  canViewManagementReports,
  canViewMasterDataDashboardShortcut,
  canViewPurchaseOrders,
} from '../auth/permissions.js';
import { ManagementDashboardPage } from './dashboard/ManagementDashboardPage.js';

export function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // RPT2: the placeholder shortcut dashboard below stays exactly as-is for
  // every non-reporting role (FACTORY_USER, QA_USER, ACCOUNTANT,
  // DISTRIBUTOR) — only the V1 reporting audience gets the real KPI
  // dashboard.
  if (canViewManagementReports(user)) {
    return <ManagementDashboardPage />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        subtitle="Inventory and dispatch tracking features will appear here."
      />
      <Card>
        <div className="flex items-start justify-between">
          <div>
            {user ? <p className="text-sm text-muted-foreground">Signed in as {user.name}</p> : null}
            <div className="mt-5 flex flex-wrap gap-3">
              {canViewMasterDataDashboardShortcut(user) && (
                <Button variant="secondary" onClick={() => navigate('/master-data/styles')}>
                  Master Data
                </Button>
              )}
              {canViewPurchaseOrders(user) && (
                <Button variant="secondary" onClick={() => navigate('/purchase-orders')}>
                  Order Sheets
                </Button>
              )}
              {canNavigateToJobOrders(user) && (
                <Button variant="secondary" onClick={() => navigate('/job-orders')}>
                  Job Orders
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
