import { Button } from '@erve/primitives';
import { useBiometricLogin } from '../auth/useBiometricLogin.js';
import type { BiometricAvailability } from '../auth/secure-session.js';

const UNAVAILABLE_COPY: Record<Exclude<BiometricAvailability, 'available' | 'unsupported'>, string> = {
  'no-hardware': 'This device has no supported fingerprint or face sensor.',
  'none-enrolled': 'Add a fingerprint or face in your device settings to use biometric login.',
  unavailable: 'Biometric login is not available right now.',
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "Biometric login" block for the Account sheet. Renders nothing outside packaged Android. */
export function BiometricLoginSection() {
  const { status, busy, error, enable, disable, otherDevices, revokeDevice, pendingRevocation, retryRevocation } =
    useBiometricLogin();

  if (!status || status.availability === 'unsupported') return null;

  const expires = formatDate(status.expiresAt);

  return (
    <div className="mt-5 border-t border-border pt-4" data-testid="biometric-login">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Biometric login
      </div>
      {status.enabled ? (
        <>
          <p className="text-sm text-foreground">
            On for this phone. You can sign in with your biometrics, even after you log out.
          </p>
          {expires ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Authorized until {expires}. After that you sign in with your password once to turn it
              on again.
            </p>
          ) : null}
          <div className="mt-3">
            <Button variant="secondary" width="fill" disabled={busy} onClick={() => void disable()}>
              Turn off biometric login
            </Button>
          </div>
          {otherDevices.length > 0 ? (
            <div className="mt-4" data-testid="other-devices">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Other phones
              </div>
              <ul className="flex flex-col gap-2">
                {otherDevices.map((device) => (
                  <li key={device.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate text-foreground">{device.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        Until {formatDate(device.expiresAt) ?? 'unknown'}
                      </span>
                    </span>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void revokeDevice(device.id)}
                      aria-label={`Remove ${device.label}`}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : status.availability === 'available' ? (
        <>
          <p className="text-sm text-muted-foreground">
            {status.legacy
              ? 'Biometric login now keeps working after you log out. Turn it on again to upgrade.'
              : 'Sign in with your fingerprint or face instead of typing your password, even after you log out.'}
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
      {pendingRevocation ? (
        <div className="mt-3" data-testid="pending-revocation">
          <p className="text-sm text-muted-foreground">
            Biometric login is off on this phone, but Erve could not be reached to cancel its
            authorization yet. Nothing on this phone can use it. It will be cancelled automatically
            the next time you are online.
          </p>
          <div className="mt-2">
            <Button variant="secondary" width="fill" disabled={busy} onClick={() => void retryRevocation()}>
              Cancel it now
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
