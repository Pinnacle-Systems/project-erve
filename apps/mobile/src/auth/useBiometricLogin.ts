import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './AuthContext.js';
import { biometricErrorMessage } from './biometric-messages.js';
import { nativeBiometric, type BiometricStatus } from './secure-session.js';

/** Reads and changes this device's biometric login for the signed-in user. */
export function useBiometricLogin() {
  const { user } = useAuth();
  const [status, setStatus] = useState<BiometricStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStatus(await nativeBiometric.status());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void nativeBiometric.status().then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(
    async (action: () => Promise<void>): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        await action();
        return true;
      } catch (failure) {
        setError(biometricErrorMessage(failure));
        return false;
      } finally {
        await refresh().catch(() => undefined);
        setBusy(false);
      }
    },
    [refresh],
  );

  const enable = useCallback(
    () => run(() => (user ? nativeBiometric.enable(user.id) : Promise.reject(new Error('no user')))),
    [run, user],
  );
  const disable = useCallback(() => run(() => nativeBiometric.disable()), [run]);

  return { status, busy, error, enable, disable };
}
