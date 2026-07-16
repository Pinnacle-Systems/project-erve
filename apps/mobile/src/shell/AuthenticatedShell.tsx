import { Outlet } from 'react-router-dom';
import { AccountMenu } from './AccountMenu.js';

/**
 * Wraps every authenticated route (see routes/AppRoutes.tsx) with a header
 * carrying the account trigger, so theme selection and log out live in one
 * place instead of being duplicated onto each page. Individual pages own
 * their own background/scroll container; this shell is header chrome only.
 */
export function AuthenticatedShell() {
  return (
    <>
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface/95 px-4 py-2 backdrop-blur-sm">
        <span className="text-sm font-semibold text-foreground">Erve</span>
        <AccountMenu />
      </header>
      <Outlet />
    </>
  );
}

AuthenticatedShell.displayName = 'AuthenticatedShell';
