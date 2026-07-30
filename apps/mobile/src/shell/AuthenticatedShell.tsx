import { Outlet } from 'react-router-dom';
import { AccountMenu } from './AccountMenu.js';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';

/**
 * Wraps every authenticated route (see routes/AppRoutes.tsx) with a header
 * carrying the account trigger, so theme selection and log out live in one
 * place instead of being duplicated onto each page. Individual pages own
 * their own background/scroll container; this shell is header chrome only.
 */
export function AuthenticatedShell() {
  const { user } = useAuth();
  return (
    <>
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface/95 px-4 py-2 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <Link to="/dashboard" className="text-sm font-semibold text-foreground">
            Erve
          </Link>
          {user?.roles.includes('FACTORY_USER') && (
            <>
              <Link
                to="/factory-tasks"
                className="min-h-11 content-center text-sm text-[var(--erp-text-link)]"
              >
                My tasks
              </Link>
              <Link
                to="/factory-rework"
                className="min-h-11 content-center text-sm text-[var(--erp-text-link)]"
              >
                QA rework
              </Link>
            </>
          )}
          {user?.roles.includes('QA_USER') && (
            <Link to="/qa" className="min-h-11 content-center text-sm text-[var(--erp-text-link)]">
              QA
            </Link>
          )}
        </div>
        <AccountMenu />
      </header>
      <Outlet />
    </>
  );
}

AuthenticatedShell.displayName = 'AuthenticatedShell';
