import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Button } from '@erve/primitives';
import { ErrorState } from '@erve/data-display';
import { useAuth } from '../auth/AuthContext.js';
import type { ReturnToState } from '../auth/return-to.js';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, status, retrySession } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return null;
  }

  if (status === 'unavailable') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--erp-color-app-bg)] px-4">
        <ErrorState
          className="w-full max-w-md"
          title="Unable to reach ERVE"
          description="Your session could not be checked because the server or network is unavailable. You are still signed in — try again in a moment."
          action={
            <Button type="button" onClick={retrySession}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  // `reauth-required` keeps `user`, so the page stays mounted underneath the
  // in-place sign-in dialog (see SessionManager).
  if (!user) {
    const state: ReturnToState = {
      from: { pathname: location.pathname, search: location.search, hash: location.hash },
    };
    return <Navigate to="/login" replace state={state} />;
  }

  return <>{children}</>;
}
