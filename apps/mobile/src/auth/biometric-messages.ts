import { BiometricError } from './secure-session.js';
import { TrustedDeviceError } from './trusted-device.js';

/** Shown when the server (or the phone) ended biometric sign-in for this device. */
export const DEVICE_AUTHORIZATION_ENDED_NOTICE =
  'Biometric sign-in is no longer authorized for this phone. Sign in with your password.';

/** User-facing wording for a failed biometric step. Never reveals anything beyond the category. */
export function biometricErrorMessage(error: unknown): string {
  if (error instanceof TrustedDeviceError) {
    switch (error.code) {
      case 'offline':
        return 'Can’t reach Erve. Check your connection and try again, or use your password.';
      case 'server':
        return 'Erve is temporarily unavailable. Try again in a moment, or use your password.';
      case 'rate-limited':
        return 'Too many attempts. Wait a minute, or use your password.';
      case 'device-invalid':
        return DEVICE_AUTHORIZATION_ENDED_NOTICE;
      case 'password-required':
        return 'Sign out and sign in with your password, then turn on biometric login.';
      case 'device-limit':
        return 'Too many phones use biometric login for this account. Turn it off on another phone first.';
      default:
        return 'Biometric sign-in failed. Try again or use your password.';
    }
  }
  if (!(error instanceof BiometricError)) {
    return 'Biometric authentication failed. Try again or use your password.';
  }
  switch (error.code) {
    case 'cancelled':
      return 'Biometric authentication was cancelled. Try again or use your password.';
    case 'lockout':
      return 'Too many unsuccessful attempts. Use your password, or try again later.';
    case 'unavailable':
      return 'Biometric authentication is not available right now. Use your password.';
    case 'key-invalidated':
      return 'Your device biometrics changed, so biometric login was turned off. Sign in with your password.';
    case 'already-registered':
      return 'Biometric login is already turned on for this phone.';
    default:
      return 'Biometric authentication failed. Try again or use your password.';
  }
}
