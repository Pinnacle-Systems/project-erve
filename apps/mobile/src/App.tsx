import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@erve/theme';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext.js';
import { queryClient } from './lib/query-client.js';
import { AppRoutes } from './routes/AppRoutes.js';
import { ThemeDocumentMeta } from './theme/ThemeDocumentMeta.js';
import { NativeThemeSurfaces } from './theme/NativeThemeSurfaces.js';

export function App() {
  return (
    // No `colorMode` prop: ThemeProvider runs uncontrolled, defaulting to
    // the persisted preference (or "system") — see packages/theme's
    // getStoredThemePreference(). Mirrors apps/web/src/App.tsx; do not
    // reintroduce a controlled prop here without also removing the
    // user-facing selector (theme/ThemeModeMenu.js).
    <ThemeProvider theme="default" density="comfortable">
      <ThemeDocumentMeta />
      <NativeThemeSurfaces />
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
