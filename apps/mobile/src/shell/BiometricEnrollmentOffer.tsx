import { useEffect, useState } from 'react';
import { Button, Dialog, DialogContent, DialogTitle } from '@erve/primitives';
import { useAuth } from '../auth/AuthContext.js';
import { useBiometricLogin } from '../auth/useBiometricLogin.js';

const DECLINED_KEY = 'erve.biometricOfferDeclined';

function wasDeclined(): boolean {
  try {
    return localStorage.getItem(DECLINED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberDeclined(): void {
  try {
    localStorage.setItem(DECLINED_KEY, '1');
  } catch {
    // The offer simply shows again next time.
  }
}

/**
 * Offered once, right after a password sign-in, when strong biometrics are
 * available and biometric sign-in is not registered on this phone. A phone that
 * already has a valid registration is never asked again. "Not now" is
 * remembered on this device; the Account menu still offers it. After an upgrade
 * from v0.2.0 the same dialog explains the upgrade.
 */
export function BiometricEnrollmentOffer() {
  const { biometricOfferPending, biometricOfferMigration, dismissBiometricOffer } = useAuth();
  const { status, busy, error, enable } = useBiometricLogin();
  const [declinedBefore] = useState(wasDeclined);

  // An upgrading user is asked again even if they once said "Not now": it is a different feature now.
  const eligible =
    status?.availability === 'available' &&
    !status.enabled &&
    (biometricOfferMigration || !declinedBefore);

  useEffect(() => {
    // Nothing to offer: not packaged Android, no strong biometric, already on, or declined earlier.
    if (biometricOfferPending && status && !eligible) dismissBiometricOffer();
  }, [biometricOfferPending, status, eligible, dismissBiometricOffer]);

  const open = biometricOfferPending && eligible;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && dismissBiometricOffer()}>
      <DialogContent variant="bottom-sheet" aria-describedby={undefined}>
        <DialogTitle>
          {biometricOfferMigration ? 'Upgrade biometric login?' : 'Use biometric login?'}
        </DialogTitle>
        <p className="mt-2 text-sm text-muted-foreground">
          {biometricOfferMigration
            ? 'Biometric login now works even after you log out. Turn it on again to authorize this phone. '
            : 'Sign in with your fingerprint or face instead of your password, even after you log out. '}
          Your password is never stored, and you can turn this off in the Account menu.
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex flex-col gap-2">
          <Button
            variant="default"
            width="fill"
            disabled={busy}
            onClick={async () => {
              if (await enable()) dismissBiometricOffer();
            }}
          >
            Turn on
          </Button>
          <Button
            variant="secondary"
            width="fill"
            disabled={busy}
            onClick={() => {
              rememberDeclined();
              dismissBiometricOffer();
            }}
          >
            Not now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
