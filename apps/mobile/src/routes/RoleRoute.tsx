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
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!hasAnyRole(user, allowed)) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
