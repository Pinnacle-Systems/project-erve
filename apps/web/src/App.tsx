import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@erve/theme';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { PublicCartonDeliveryPage } from './pages/delivery/PublicCartonDeliveryPage.js';
import { AuthProvider } from './auth/AuthContext.js';
import { SessionManager } from './auth/session/SessionManager.js';
import { queryClient } from './lib/query-client.js';
import { AppRoutes } from './routes/AppRoutes.js';
import { ThemeDocumentMeta } from './theme/ThemeDocumentMeta.js';

function AppBoundary() {
  const location = useLocation();
  if (location.pathname === '/delivery/carton') return <PublicCartonDeliveryPage />;
  return (
    <AuthProvider>
      <AppRoutes />
      <SessionManager />
    </AuthProvider>
  );
}

export function App() {
  return (
    // No `colorMode` prop: ThemeProvider runs uncontrolled, defaulting to
    // the persisted preference (or "system") — see packages/theme's
    // getStoredThemePreference(). Do not reintroduce a controlled prop here
    // without also removing the user-facing selector (ThemeModeMenu).
    <ThemeProvider theme="default" density="compact">
      <ThemeDocumentMeta />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AppBoundary />
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
