import { isAxiosError } from 'axios';
import type {
  ApiSuccessResponse,
  AuthUser,
  RegisterTrustedDeviceRequest,
  TrustedDevice,
  TrustedDeviceChallenge,
  TrustedDeviceSignInRequest,
} from '@erve/types';
import { apiClient } from '../lib/api-client.js';
import {
  BiometricError,
  nativeBiometric,
  nativeSecureSession,
  type BiometricStatus,
} from './secure-session.js';

/**
 * Biometric trusted-device flows, orchestrating the native key (secure-session.ts) and the
 * server endpoints (see apps/api trusted-device.service.ts). Native code never talks to the
 * network and this module never sees a private key: it only moves challenges, public keys and
 * signatures between the two.
 */

export type TrustedDeviceErrorCode =
  /** No response: offline, DNS, timeout. */
  | 'offline'
  | 'server'
  | 'rate-limited'
  /** The server no longer authorizes this phone (expired, revoked, user inactive, password reset). */
  | 'device-invalid'
  /** Enabling needs a session that started with a password. */
  | 'password-required'
  | 'device-limit'
  | 'failed';

export class TrustedDeviceError extends Error {
  constructor(
    public readonly code: TrustedDeviceErrorCode,
    options?: ErrorOptions,
  ) {
    super(`Trusted device: ${code}`, options);
    this.name = 'TrustedDeviceError';
  }
}

function serverCode(error: unknown): string | undefined {
  if (!isAxiosError(error)) return undefined;
  const code = (error.response?.data as { error?: { code?: unknown } } | undefined)?.error?.code;
  return typeof code === 'string' ? code : undefined;
}

function classify(error: unknown): TrustedDeviceError {
  if (error instanceof TrustedDeviceError) return error;
  if (!isAxiosError(error)) return new TrustedDeviceError('failed', { cause: error });
  const status = error.response?.status;
  if (!error.response) return new TrustedDeviceError('offline', { cause: error });
  const code = serverCode(error);
  if (code === 'DEVICE_AUTHORIZATION_INVALID' || code === 'INVALID_SIGNATURE') {
    return new TrustedDeviceError('device-invalid', { cause: error });
  }
  if (code === 'PASSWORD_SIGN_IN_REQUIRED') return new TrustedDeviceError('password-required', { cause: error });
  if (code === 'DEVICE_LIMIT_REACHED') return new TrustedDeviceError('device-limit', { cause: error });
  if (status === 429) return new TrustedDeviceError('rate-limited', { cause: error });
  if (status !== undefined && status >= 500) return new TrustedDeviceError('server', { cause: error });
  return new TrustedDeviceError('failed', { cause: error });
}

/**
 * Turns biometric login on for the signed-in user. The signed-in session must have started with a
 * password (the server enforces it). One strong-biometric prompt proves the new key works and
 * that the person present can use it.
 */
export async function enableTrustedDevice(userId: string): Promise<TrustedDevice> {
  const key = await nativeBiometric.createKey();
  let device: TrustedDevice;
  try {
    const challenge = (
      await apiClient.post<ApiSuccessResponse<TrustedDeviceChallenge>>('/auth/trusted-devices/challenge')
    ).data.data;
    const signature = await nativeBiometric.sign(challenge.message, 'register');
    const body: RegisterTrustedDeviceRequest = {
      challengeId: challenge.challengeId,
      publicKey: key.publicKey,
      signature,
      label: key.deviceLabel,
      ...(key.appVersion ? { appVersion: key.appVersion } : {}),
    };
    device = (
      await apiClient.post<ApiSuccessResponse<{ device: TrustedDevice }>>('/auth/trusted-devices', body)
    ).data.data.device;
  } catch (error) {
    await nativeBiometric.discardKey();
    if (error instanceof BiometricError) throw error;
    throw classify(error);
  }

  try {
    await nativeBiometric.commit({ deviceId: device.id, userId, expiresAt: device.expiresAt });
  } catch (error) {
    // The server trusts a key this phone failed to adopt: take the authorization back.
    await nativeBiometric.discardKey();
    await apiClient
      .delete(`/auth/trusted-devices/${device.id}`, { params: { revokeSessions: false } })
      .catch(() => undefined);
    throw error;
  }
  return device;
}

export interface BiometricSignIn {
  accessToken: string;
  user: AuthUser;
}

/**
 * Signs in with the registered device: fetches a challenge, asks for a strong biometric to sign it,
 * and exchanges the signature for a brand-new session whose refresh credential is stored natively.
 * The server is asked for the challenge first, so offline never reaches the prompt.
 */
export async function signInWithTrustedDevice(deviceId: string): Promise<BiometricSignIn> {
  let challenge: TrustedDeviceChallenge;
  try {
    challenge = (
      await apiClient.post<ApiSuccessResponse<TrustedDeviceChallenge>>(
        '/auth/mobile/trusted-device/challenge',
        { deviceId },
      )
    ).data.data;
  } catch (error) {
    throw await handleSignInFailure(error);
  }

  const signature = await nativeBiometric.sign(challenge.message, 'sign-in');

  try {
    const body: TrustedDeviceSignInRequest = { deviceId, challengeId: challenge.challengeId, signature };
    const data = (
      await apiClient.post<
        ApiSuccessResponse<{ accessToken: string; refreshToken: string; user: AuthUser }>
      >('/auth/mobile/trusted-device/sign-in', body)
    ).data.data;
    if (!data.refreshToken) throw new Error('Mobile refresh session was not returned');
    await nativeSecureSession.set(data.refreshToken);
    return { accessToken: data.accessToken, user: data.user };
  } catch (error) {
    throw await handleSignInFailure(error);
  }
}

async function handleSignInFailure(error: unknown): Promise<TrustedDeviceError> {
  const failure = classify(error);
  if (failure.code === 'device-invalid') {
    // The server says this registration is dead: drop the key. There is nothing left to revoke.
    await nativeBiometric.remove({ keepPendingRevocation: false }).catch(() => undefined);
  }
  return failure;
}

/**
 * Turns biometric login off. The local half comes first and cannot fail on the network: the signing
 * key is deleted at once, so this phone can no longer authenticate whatever the server still says.
 * The server revocation then follows; if it cannot be completed it is remembered natively and
 * retried (see flushPendingRevocation) rather than silently dropped.
 *
 * Returns true when the server confirmed the revocation.
 */
export async function disableTrustedDevice(): Promise<boolean> {
  await nativeBiometric.remove({ keepPendingRevocation: true });
  const status = await nativeBiometric.status();
  if (!status.pendingRevocation) return true;
  return flushPendingRevocation(status.pendingRevocation.userId);
}

/**
 * Completes a revocation that could not be sent earlier, if it belongs to the signed-in user.
 * Keeps the pending record on any failure so it is tried again; returns whether none remains.
 */
export async function flushPendingRevocation(signedInUserId: string): Promise<boolean> {
  const status = await nativeBiometric.status();
  const pending = status.pendingRevocation;
  if (!pending) return true;
  if (pending.userId !== signedInUserId) return false;
  try {
    // Keep the current session: the person may be turning biometrics off from inside it.
    await apiClient.delete(`/auth/trusted-devices/${pending.deviceId}`, {
      params: { revokeSessions: false },
    });
  } catch (error) {
    // Already gone counts as done; anything else is retried later.
    if (!(isAxiosError(error) && error.response?.status === 404)) return false;
  }
  await nativeBiometric.clearPendingRevocation();
  return true;
}

export async function listTrustedDevices(): Promise<TrustedDevice[]> {
  const response = await apiClient.get<ApiSuccessResponse<{ devices: TrustedDevice[] }>>(
    '/auth/trusted-devices',
  );
  return response.data.data.devices;
}

/** Revokes another phone's authorization and the sessions it started. */
export async function revokeTrustedDevice(deviceId: string): Promise<void> {
  await apiClient.delete(`/auth/trusted-devices/${deviceId}`);
}

export type { BiometricStatus };
