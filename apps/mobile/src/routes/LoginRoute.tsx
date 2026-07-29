import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';
import { LoginPage } from '../pages/LoginPage.js';

export function LoginRoute() {
  const { status, retrySession } = useAuth();

  if (status === 'loading') {
    return null;
  }

  if (status === 'authenticated') {
    return <Navigate to="/dashboard" replace />;
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

  return <LoginPage />;
}
