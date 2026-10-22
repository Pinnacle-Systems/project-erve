import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@erve/app-components';
import { Button } from '@erve/primitives';

export function RetiredInvoiceHandoffPage() {
  const navigate = useNavigate();

  return (
    <div className="space-y-4">
      <PageHeader
        density="compact"
        wrapActions
        title="Invoice Handoff has been retired"
        subtitle="This legacy workflow is no longer available."
        primaryAction={
          <Button density="compact" onClick={() => navigate('/dashboard')}>
            Return to Dashboard
          </Button>
        }
      />
    </div>
  );
}
