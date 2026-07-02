import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { Card } from '@erve/layout';
import { useAuth } from '../auth/AuthContext.js';

export function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canViewPurchaseOrders = user?.roles.some((role) =>
    ['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT', 'DISTRIBUTOR'].includes(role),
  ) ?? false;
  const canViewJobOrders = user?.roles.some((role) =>
    ['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT', 'FACTORY_USER', 'QA_USER'].includes(role),
  ) ?? false;

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
              <Button variant="secondary" onClick={() => navigate('/master-data/styles')}>
                Master Data
              </Button>
              {canViewPurchaseOrders && (
                <Button variant="secondary" onClick={() => navigate('/purchase-orders')}>
                  Purchase Orders
                </Button>
              )}
              {canViewJobOrders && (
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
