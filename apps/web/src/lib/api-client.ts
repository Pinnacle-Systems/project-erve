import {
  configureRefreshCoordinator,
  configureSessionTimingStorage,
  createBrowserRefreshCoordinator,
} from '@erve/client';

// Browser tabs share one HttpOnly refresh cookie: serialise refreshes across
// tabs and share their results (see createBrowserRefreshCoordinator). The
// session timing is kept in localStorage so every tab — and a reload — sees
// the latest server-issued expiry instants (no secrets are stored there).
configureRefreshCoordinator(createBrowserRefreshCoordinator());
try {
  configureSessionTimingStorage(window.localStorage);
} catch {
  configureSessionTimingStorage(null);
}

export {
  AUTH_EXPIRED_EVENT,
  apiClient,
  logoutSession,
  publishSignedInSession,
  refreshAccessToken,
} from '@erve/client';
