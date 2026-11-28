import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@erve/layout';
import { Button } from '@erve/primitives';
import { useAuth } from './AuthContext.js';
import { biometricErrorMessage } from './biometric-messages.js';
import { PoweredByPinnacleBranding } from '../branding/PoweredByPinnacleBranding.js';
import erveLogo from '../../branding/erve-logo.png';

/**
 * Shown when biometric sign-in is registered on this phone and there is no session: at launch, after
 * a logout, and after a session ended. At launch the system prompt opens once by itself; after a
 * logout it waits for a tap. The password form is always one tap away.
 */
export function BiometricUnlockScreen() {
  const { signInWithBiometrics, switchToPassword, autoPromptBiometric, biometricLock } = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const autoPrompted = useRef(false);

  const unlock = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      await signInWithBiometrics();
    } catch (error) {
      setMessage(biometricErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [signInWithBiometrics]);

  useEffect(() => {
    if (autoPrompted.current || !autoPromptBiometric) return;
    autoPrompted.current = true;
    void unlock();
  }, [unlock, autoPromptBiometric]);

  return (
    <div className="login-page bg-background">
      <header className="login-logo flex flex-col items-center gap-2 bg-surface">
        <img src={erveLogo} alt="Erve India" className="h-auto w-64 max-w-full" />
        <p className="text-sm text-muted-foreground">
          {biometricLock === 'legacy' ? 'Unlock to continue' : 'Sign in to your Erve account'}
        </p>
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
              Sign in with biometrics
            </Button>
            <Button
              type="button"
              variant="secondary"
              width="fill"
              className="w-full"
              disabled={busy}
              onClick={switchToPassword}
            >
              Sign in with password
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
