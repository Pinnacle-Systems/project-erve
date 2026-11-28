import { BiometricError } from './secure-session.js';

/** User-facing wording for a failed biometric prompt. Never reveals anything beyond the category. */
export function biometricErrorMessage(error: unknown): string {
  if (!(error instanceof BiometricError)) return 'Biometric authentication failed. Try again or use your password.';
  switch (error.code) {
    case 'cancelled':
      return 'Biometric authentication was cancelled. Try again or use your password.';
    case 'lockout':
      return 'Too many unsuccessful attempts. Use your password, or try again later.';
    case 'unavailable':
      return 'Biometric authentication is not available right now. Use your password.';
    case 'key-invalidated':
      return 'Your device biometrics changed. Sign in with your password.';
    case 'no-session':
      return 'There is no active session to protect. Sign in again.';
    default:
      return 'Biometric authentication failed. Try again or use your password.';
  }
}
