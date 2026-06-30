import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import type { Role } from '@erve/types';
import { hasAnyRole } from '@erve/shared';
import { useAuth } from '../auth/AuthContext.js';
import { ProtectedRoute } from './ProtectedRoute.js';

export function RoleRoute({
  allowed,
  children,
}: {
  allowed: readonly Role[];
  children: ReactNode;
}) {
  const { user } = useAuth();

  return (
    <ProtectedRoute>
      {user && !hasAnyRole(user, allowed) ? <Navigate to="/forbidden" replace /> : children}
    </ProtectedRoute>
  );
}
