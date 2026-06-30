import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Button } from '@erve/primitives';
import { useAuth } from '../auth/AuthContext.js';

export function AppLayout() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const canManagePOs = user?.roles.some((r) => ['ADMIN', 'MERCHANDISER', 'DISTRIBUTOR'].includes(r)) ?? false;
  const canViewMasterData = user?.roles.some((r) =>
    ['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT', 'FACTORY_USER'].includes(r),
  ) ?? false;
  const canViewJobOrders = user?.roles.some((r) =>
    ['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT', 'FACTORY_USER', 'QA_USER'].includes(r),
  ) ?? false;

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-surface px-5 py-6 md:block">
        <div className="text-base font-semibold text-foreground">Erve</div>
        <nav className="mt-8 space-y-1">
          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              `block rounded-md px-3 py-2 text-sm ${isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-surface-muted'}`
            }
          >
            Dashboard
          </NavLink>
          {canViewMasterData && (
            <NavLink
              to="/master-data"
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm ${isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-surface-muted'}`
              }
            >
              Master Data
            </NavLink>
          )}
          <div className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Orders
          </div>
          <NavLink
            to="/purchase-orders"
            end
            className={({ isActive }) =>
              `block rounded-md px-3 py-2 text-sm ${isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-surface-muted'}`
            }
          >
            Purchase Orders
          </NavLink>
          {canManagePOs && (
            <NavLink
              to="/purchase-orders/new"
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm ${isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-surface-muted'}`
              }
            >
              + New PO
            </NavLink>
          )}
          {canViewJobOrders && (
            <NavLink
              to="/job-orders"
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm ${isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-surface-muted'}`
              }
            >
              Job Orders
            </NavLink>
          )}
        </nav>
      </aside>
      <div className="md:pl-64">
        <header className="sticky top-0 z-10 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur md:px-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-foreground">{user?.name}</div>
              <div className="text-xs text-muted-foreground">{user?.roles.join(', ')}</div>
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                logout();
                navigate('/login');
              }}
            >
              Log out
            </Button>
          </div>
        </header>
        <main className="px-4 py-6 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
