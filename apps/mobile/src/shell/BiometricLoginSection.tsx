import { Button } from '@erve/primitives';
import { useBiometricLogin } from '../auth/useBiometricLogin.js';
import type { BiometricAvailability } from '../auth/secure-session.js';

const UNAVAILABLE_COPY: Record<Exclude<BiometricAvailability, 'available' | 'unsupported'>, string> = {
  'no-hardware': 'This device has no supported fingerprint or face sensor.',
  'none-enrolled': 'Add a fingerprint or face in your device settings to use biometric login.',
  unavailable: 'Biometric login is not available right now.',
};

/** "Biometric login" block for the Account sheet. Renders nothing outside packaged Android. */
export function BiometricLoginSection() {
  const { status, busy, error, enable, disable } = useBiometricLogin();

  if (!status || status.availability === 'unsupported') return null;

  return (
    <div className="mt-5 border-t border-border pt-4" data-testid="biometric-login">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Biometric login
      </div>
      {status.enabled ? (
        <>
          <p className="text-sm text-foreground">
            On. Unlock Erve with your biometrics when you open the app.
          </p>
          <div className="mt-3">
            <Button variant="secondary" width="fill" disabled={busy} onClick={() => void disable()}>
              Turn off biometric login
            </Button>
          </div>
        </>
      ) : status.availability === 'available' ? (
        <>
          <p className="text-sm text-muted-foreground">
            Use your fingerprint or face to unlock Erve instead of typing your password.
          </p>
          <div className="mt-3">
            <Button variant="secondary" width="fill" disabled={busy} onClick={() => void enable()}>
              Turn on biometric login
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{UNAVAILABLE_COPY[status.availability]}</p>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
