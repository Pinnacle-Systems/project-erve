import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';
import { LoginPage } from '../pages/LoginPage.js';
import { SessionStateScreen } from './SessionStateScreen.js';

export function LoginRoute() {
  const { status, retrySession } = useAuth();

  if (status === 'loading') {
    return <SessionStateScreen status="loading" />;
  }

  if (status === 'authenticated') {
    return <Navigate to="/dashboard" replace />;
  }

  if (status === 'unavailable') {
    return <SessionStateScreen status="unavailable" onRetry={retrySession} />;
  }

  return <LoginPage />;
}
