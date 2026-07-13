import { Card } from '@erve/layout';
import { ThemeModeMenu } from '../theme/ThemeModeMenu.js';

export function DashboardPage() {
  return (
    <div className="min-h-screen bg-background p-4">
      <Card>
        <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Inventory and dispatch tracking features will appear here.
        </p>
      </Card>
      <Card className="mt-4">
        <h2 className="text-sm font-semibold text-foreground">Preferences</h2>
        <ThemeModeMenu />
      </Card>
    </div>
  );
}
