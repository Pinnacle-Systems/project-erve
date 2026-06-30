import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@erve/theme';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext.js';
import { queryClient } from './lib/query-client.js';
import { AppRoutes } from './routes/AppRoutes.js';

export function App() {
  return (
    <ThemeProvider theme="default" density="comfortable" colorMode="light">
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
