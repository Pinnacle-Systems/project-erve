import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();

  if (status === 'loading') {
    return null;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
