import { EmptyState } from '@erve/data-display';
import { Card } from '@erve/layout';

export function ForbiddenPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm text-center">
        <EmptyState
          tone="permission"
          title="Access denied"
          description="Your account does not have permission to view this page."
        />
      </Card>
    </div>
  );
}
