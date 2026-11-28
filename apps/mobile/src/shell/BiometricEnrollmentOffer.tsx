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
 * available and not yet enabled. "Not now" is remembered on this device; the
 * Account menu still offers it.
 */
export function BiometricEnrollmentOffer() {
  const { biometricOfferPending, dismissBiometricOffer } = useAuth();
  const { status, busy, error, enable } = useBiometricLogin();
  const [declinedBefore] = useState(wasDeclined);

  const eligible = status?.availability === 'available' && !status.enabled && !declinedBefore;

  useEffect(() => {
    // Nothing to offer: not packaged Android, no strong biometric, already on, or declined earlier.
    if (biometricOfferPending && status && !eligible) dismissBiometricOffer();
  }, [biometricOfferPending, status, eligible, dismissBiometricOffer]);

  const open = biometricOfferPending && eligible;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && dismissBiometricOffer()}>
      <DialogContent variant="bottom-sheet" aria-describedby={undefined}>
        <DialogTitle>Use biometric login?</DialogTitle>
        <p className="mt-2 text-sm text-muted-foreground">
          Unlock Erve with your fingerprint or face the next time you open the app. Your password is
          never stored, and you can turn this off in the Account menu.
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
