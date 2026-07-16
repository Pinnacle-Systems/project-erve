import { Card } from '@erve/layout';

export function DashboardPage() {
  return (
    <div className="min-h-screen bg-background p-4">
      <Card>
        <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Inventory and dispatch tracking features will appear here.
        </p>
      </Card>
    </div>
  );
}
