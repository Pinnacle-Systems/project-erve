import { z } from 'zod';

// Accepts either an email address or a mobile number in the same field —
// login is allowed via either identifier.
export const loginSchema = z.object({
  identifier: z.string().min(1, 'Email or mobile number is required'),
  password: z.string().min(1, 'Password is required'),
});

export type LoginInput = z.infer<typeof loginSchema>;

// See RefreshRequest in @erve/types: omitted `activity` means true.
export const refreshSchema = z
  .object({ activity: z.boolean().optional() })
  .optional()
  .transform((body) => ({ activity: body?.activity ?? true }));

export const mobileRefreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
  activity: z.boolean().optional(),
});

const identifier = z.string().min(1).max(64);
// Android's `SHA256withECDSA` signature (DER) is at most 72 bytes; base64 stays under 100.
const signature = z.string().min(1).max(160);
// Unicode "Cc" (control) characters, so a label cannot smuggle newlines into logs or the UI.
const controlCharacters = /\p{Cc}/gu;

export const trustedDeviceChallengeSchema = z.object({ deviceId: identifier });

export const trustedDeviceSignInSchema = z.object({
  deviceId: identifier,
  challengeId: identifier,
  signature,
});

export const registerTrustedDeviceSchema = z.object({
  challengeId: identifier,
  publicKey: z.string().min(1).max(400),
  signature,
  label: z
    .string()
    .transform((value) => value.replace(controlCharacters, ' ').trim())
    .pipe(z.string().min(1).max(80)),
  appVersion: z
    .string()
    .transform((value) => value.replace(controlCharacters, ' ').trim())
    .pipe(z.string().max(32))
    .optional(),
});

export const revokeTrustedDeviceQuerySchema = z.object({
  // Omitted means the session(s) the device started are revoked with it.
  revokeSessions: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value !== 'false'),
});
