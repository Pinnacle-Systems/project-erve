import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@erve/layout';
import { Button } from '@erve/primitives';
import { useAuth } from './AuthContext.js';
import { biometricErrorMessage } from './biometric-messages.js';
import { PoweredByPinnacleBranding } from '../branding/PoweredByPinnacleBranding.js';
import erveLogo from '../../branding/erve-logo.png';

/**
 * Shown at launch when biometric login is enabled. The system prompt opens
 * automatically once; the password form is always one tap away.
 */
export function BiometricUnlockScreen() {
  const { unlockWithBiometrics, switchToPassword } = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const autoPrompted = useRef(false);

  const unlock = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      await unlockWithBiometrics();
    } catch (error) {
      setMessage(biometricErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [unlockWithBiometrics]);

  useEffect(() => {
    if (autoPrompted.current) return;
    autoPrompted.current = true;
    void unlock();
  }, [unlock]);

  return (
    <div className="login-page bg-background">
      <header className="login-logo flex flex-col items-center gap-2 bg-surface">
        <img src={erveLogo} alt="Erve India" className="h-auto w-64 max-w-full" />
        <p className="text-sm text-muted-foreground">Unlock to continue</p>
      </header>
      <main className="login-main">
        <Card className="login-card">
          <div className="flex flex-col gap-4">
            {message && (
              <p role="alert" className="text-sm text-danger">
                {message}
              </p>
            )}
            <Button
              type="button"
              variant="default"
              width="fill"
              className="w-full"
              disabled={busy}
              onClick={() => void unlock()}
            >
              Unlock with biometrics
            </Button>
            <Button
              type="button"
              variant="secondary"
              width="fill"
              className="w-full"
              disabled={busy}
              onClick={switchToPassword}
            >
              Use password instead
            </Button>
          </div>
        </Card>
      </main>
      <footer className="flex items-center justify-center gap-2 border-t border-border px-6 py-6">
        <PoweredByPinnacleBranding className="justify-center" logoClassName="h-8" />
      </footer>
    </div>
  );
}
