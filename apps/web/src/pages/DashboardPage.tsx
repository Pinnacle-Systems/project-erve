import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { Card } from '@erve/layout';
import { useAuth } from '../auth/AuthContext.js';
import {
  canViewJobOrders,
  canViewMasterDataDashboardShortcut,
  canViewPurchaseOrders,
} from '../auth/permissions.js';

export function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

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
                  Purchase Orders
                </Button>
              )}
              {canViewJobOrders(user) && (
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
