import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import type { Role } from '@erve/types';
import { hasAnyRole, isValidTransporterRoleCombination } from '@erve/shared';
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
      {user && (!isValidTransporterRoleCombination(user.roles) || !hasAnyRole(user, allowed)) ? <Navigate to="/forbidden" replace /> : children}
    </ProtectedRoute>
  );
}
