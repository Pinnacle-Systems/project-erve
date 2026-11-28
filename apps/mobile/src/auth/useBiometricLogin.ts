import { useCallback, useEffect, useState } from 'react';
import type { TrustedDevice } from '@erve/types';
import { useAuth } from './AuthContext.js';
import { biometricErrorMessage } from './biometric-messages.js';
import { nativeBiometric, type BiometricStatus } from './secure-session.js';
import {
  disableTrustedDevice,
  enableTrustedDevice,
  flushPendingRevocation,
  listTrustedDevices,
  revokeTrustedDevice,
} from './trusted-device.js';

/** Reads and changes this phone's biometric sign-in for the signed-in user. */
export function useBiometricLogin() {
  const { user } = useAuth();
  const [status, setStatus] = useState<BiometricStatus | null>(null);
  const [otherDevices, setOtherDevices] = useState<TrustedDevice[]>([]);
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

  // The other phones this account has authorized, so one that is lost can be revoked from here.
  const enabledDeviceId = status?.enabled ? status.deviceId : null;
  const [deviceListVersion, setDeviceListVersion] = useState(0);
  useEffect(() => {
    if (!enabledDeviceId) return;
    let cancelled = false;
    listTrustedDevices()
      .then((all) => {
        if (!cancelled) setOtherDevices(all.filter((device) => device.id !== enabledDeviceId));
      })
      .catch(() => {
        // Listing is a convenience; its failure never affects signing in.
        if (!cancelled) setOtherDevices([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabledDeviceId, deviceListVersion]);

  const run = useCallback(
    async (action: () => Promise<unknown>): Promise<boolean> => {
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
    () => run(() => (user ? enableTrustedDevice(user.id) : Promise.reject(new Error('no user')))),
    [run, user],
  );

  // Local key first, then the server: see disableTrustedDevice. If the server cannot be reached the
  // pending revocation stays visible (status.pendingRevocation) and is retried.
  const disable = useCallback(() => run(() => disableTrustedDevice()), [run]);

  const retryRevocation = useCallback(
    () => run(() => (user ? flushPendingRevocation(user.id) : Promise.resolve(false))),
    [run, user],
  );

  const revokeDevice = useCallback(
    async (deviceId: string) => {
      const done = await run(() => revokeTrustedDevice(deviceId));
      if (done) setDeviceListVersion((version) => version + 1);
      return done;
    },
    [run],
  );

  const pendingRevocation =
    status?.pendingRevocation && user && status.pendingRevocation.userId === user.id
      ? status.pendingRevocation
      : null;

  return {
    status,
    busy,
    error,
    enable,
    disable,
    // Only meaningful while registered; a stale list is never shown after turning it off.
    otherDevices: enabledDeviceId ? otherDevices : [],
    revokeDevice,
    pendingRevocation,
    retryRevocation,
  };
}
