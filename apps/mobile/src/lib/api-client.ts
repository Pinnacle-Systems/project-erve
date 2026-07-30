import { configureRefreshCredentialProvider } from '@erve/client';
import { nativeSecureSession } from '../auth/secure-session.js';

configureRefreshCredentialProvider(nativeSecureSession.isAvailable() ? nativeSecureSession : null);

export {
  AUTH_EXPIRED_EVENT,
  RefreshCredentialError,
  apiClient,
  logoutSession,
  refreshAccessToken,
} from '@erve/client';
