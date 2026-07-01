import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { Card } from '@erve/layout';
import { useAuth } from '../auth/AuthContext.js';

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
            <div className="mt-5">
              <Button variant="secondary" onClick={() => navigate('/master-data/styles')}>
                Master Data
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
