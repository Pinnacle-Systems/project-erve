import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import type { Role } from '@erve/types';
import { hasAnyRole } from '@erve/shared';
import { useAuth } from '../auth/AuthContext.js';
import { SessionStateScreen } from './SessionStateScreen.js';

export function RoleRoute({
  allowed,
  children,
}: {
  allowed: readonly Role[];
  children: ReactNode;
}) {
  const { user, status, retrySession } = useAuth();

  if (status === 'loading') {
    return <SessionStateScreen status="loading" />;
  }

  if (status === 'unavailable') {
    return <SessionStateScreen status="unavailable" onRetry={retrySession} />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!hasAnyRole(user, allowed)) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
