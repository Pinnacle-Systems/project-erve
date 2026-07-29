import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import type { Role } from '@erve/types';
import { hasAnyRole } from '@erve/shared';
import { useAuth } from '../auth/AuthContext.js';

export function RoleRoute({
  allowed,
  children,
}: {
  allowed: readonly Role[];
  children: ReactNode;
}) {
  const { user, status, retrySession } = useAuth();

  if (status === 'loading') {
    return null;
  }

  if (status === 'unavailable') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <h1 className="text-xl font-semibold">Temporarily unavailable</h1>
        <p className="text-sm text-muted-foreground">
          Your session was not ended. Check your connection and try again.
        </p>
        <button
          className="min-h-12 rounded-md bg-primary px-6 text-primary-foreground"
          onClick={retrySession}
        >
          Try again
        </button>
      </main>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!hasAnyRole(user, allowed)) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
