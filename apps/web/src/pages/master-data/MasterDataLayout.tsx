import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Button } from '@erve/primitives';
import { Stack } from '@erve/layout';
import { useAuth } from '../../auth/AuthContext.js';

export function MasterDataLayout() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const canManage = user?.roles.some((role) => role === 'ADMIN' || role === 'MERCHANDISER') ?? false;
  const transactionLinks = [
    ...(user?.roles.some((role) => role === 'ADMIN' || role === 'MERCHANDISER' || role === 'SENIOR_MANAGEMENT' || role === 'DISTRIBUTOR')
      ? [{ to: '/purchase-orders', label: 'Purchase Orders' }]
      : []),
    ...(user?.roles.some((role) => role === 'ADMIN' || role === 'MERCHANDISER' || role === 'SENIOR_MANAGEMENT' || role === 'FACTORY_USER' || role === 'QA_USER')
      ? [{ to: '/job-orders', label: 'Job Orders' }]
      : []),
  ];
  const links = [
    ...(user?.roles.some((role) => role === 'ADMIN' || role === 'MERCHANDISER' || role === 'SENIOR_MANAGEMENT')
      ? [{ to: '/master-data/styles', label: 'Styles' }]
      : []),
    ...(canManage ? [{ to: '/master-data/sizes', label: 'Sizes' }] : []),
    ...(user?.roles.some((role) => role === 'ADMIN' || role === 'MERCHANDISER' || role === 'FACTORY_USER')
      ? [{ to: '/master-data/factories', label: 'Factories' }]
      : []),
    ...(canManage ? [{ to: '/master-data/process-flows', label: 'Process Flows' }] : []),
  ];

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-border-subtle bg-surface px-5 py-6 md:block">
        <div className="text-base font-semibold text-foreground">Erve</div>
        <Stack as="nav" gap="xs" className="mt-8">
          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              `block rounded-control px-3 py-2 text-sm ${
                isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground'
              }`
            }
          >
            Dashboard
          </NavLink>
          <div className="px-3 pb-1 pt-4 text-xs font-semibold uppercase text-muted-foreground">
            Master Data
          </div>
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `block rounded-control px-3 py-2 text-sm ${
                  isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground'
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
          {transactionLinks.length > 0 && (
            <div className="px-3 pb-1 pt-4 text-xs font-semibold uppercase text-muted-foreground">
              Orders
            </div>
          )}
          {transactionLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `block rounded-control px-3 py-2 text-sm ${
                  isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground'
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </Stack>
      </aside>
      <div className="md:pl-64">
        <header className="sticky top-0 z-10 border-b border-border-subtle bg-surface/95 px-4 py-3 backdrop-blur md:px-8">
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
          <nav className="mt-3 flex gap-2 overflow-x-auto md:hidden">
            {[...links, ...transactionLinks].map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-control px-3 py-2 text-sm ${
                    isActive ? 'bg-primary text-primary-foreground' : 'bg-surface-muted text-muted-foreground'
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </header>
        <main className="px-4 py-6 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
