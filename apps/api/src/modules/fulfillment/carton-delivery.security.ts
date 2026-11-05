import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { HttpError } from '../../errors/http-error.js';

export interface DeliveryConfigInput {
  enabled: boolean;
  origin: string;
  activeKey: string;
  keys: string;
  validityDays: number;
}
export interface DeliveryConfig {
  enabled: boolean;
  origin: string;
  activeKey: string;
  keys: ReadonlyMap<string, Buffer>;
  validityDays: number;
}
export function parseDeliveryConfig(input: DeliveryConfigInput): DeliveryConfig {
  const config: DeliveryConfig = { ...input, keys: new Map() };
  if (!input.enabled) return config;
  try {
    const origin = new URL(input.origin);
    if (
      origin.protocol !== 'https:' ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash
    )
      throw new Error();
    config.origin = origin.origin;
    const entries = z
      .record(z.string().regex(/^[\w-]{1,40}$/), z.string())
      .parse(JSON.parse(input.keys));
    const keys = new Map(
      Object.entries(entries).map(([version, key]) => {
        const bytes = Buffer.from(key, 'base64');
        if (bytes.length !== 32 || bytes.toString('base64') !== key) throw new Error();
        return [version, bytes] as const;
      }),
    );
    if (
      !keys.has(input.activeKey) ||
      !Number.isInteger(input.validityDays) ||
      input.validityDays < 1 ||
      input.validityDays > 3650
    )
      throw new Error();
    config.keys = keys;
    return config;
  } catch {
    // Do not include config values or parser errors: they can contain key material.
    throw new Error(
      'Invalid carton delivery configuration: HTTPS origin and versioned 256-bit keys are required',
    );
  }
}

export const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

export function createCredential(config: DeliveryConfig, cartonId: string) {
  const key = config.keys.get(config.activeKey);
  if (!config.enabled || !key) throw new Error('Carton delivery credentials are unavailable');
  const token = randomBytes(32).toString('base64url');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(cartonId));
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return {
    token,
    tokenDigest: digest(token),
    encryptedToken: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url'),
    keyVersion: config.activeKey,
  };
}

export function decryptCredential(
  config: DeliveryConfig,
  record: { encryptedToken: string; keyVersion: string },
  cartonId: string,
): string {
  try {
    const key = config.keys.get(record.keyVersion);
    if (!key) throw new Error();
    const bytes = Buffer.from(record.encryptedToken, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(cartonId));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    throw HttpError.internal(
      'Carton label credential could not be recovered; contact an administrator',
    );
  }
}

export const deliveryInputSchema = z
  .object({
    recipientName: z.string().trim().min(1).max(120),
    deliveredAt: z.iso.datetime({ offset: true }),
    timezone: z
      .string()
      .min(1)
      .max(80)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'Select a valid timezone'),
    offsetMinutes: z.number().int().min(-840).max(840),
    remarks: z.string().trim().max(2000).optional().default(''),
    confirmed: z.literal(true),
    idempotencyKey: z.uuid(),
  })
  .strict()
  .superRefine((value, context) => {
    const instant = new Date(value.deliveredAt);
    if (!Number.isFinite(instant.getTime())) return; // datetime validation already reported this.
    const local = new Date(instant.getTime() + value.offsetMinutes * 60_000)
      .toISOString()
      .slice(0, 19);
    if (local !== value.deliveredAt.slice(0, 19))
      context.addIssue({
        code: 'custom',
        path: ['offsetMinutes'],
        message: 'Offset does not match delivery time',
      });
    let parts: Intl.DateTimeFormatPart[];
    try {
      parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: value.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(instant);
    } catch {
      return;
    } // timezone refinement already reported this.
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
    const zoned = `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`;
    if (zoned !== local)
      context.addIssue({
        code: 'custom',
        path: ['timezone'],
        message: 'Timezone does not match delivery time',
      });
  });
export type DeliveryInput = z.infer<typeof deliveryInputSchema>;

export function validateDeliveryTime(deliveredAt: Date, dispatchDate: Date, now: Date): void {
  const startOfDispatchDay = Date.parse(
    `${dispatchDate.toISOString().slice(0, 10)}T00:00:00+05:30`,
  );
  if (
    !Number.isFinite(deliveredAt.getTime()) ||
    deliveredAt.getTime() < startOfDispatchDay ||
    deliveredAt.getTime() > now.getTime() + 300_000
  ) {
    throw HttpError.badRequest(
      'Delivery time must be on or after the Dispatch date and no more than five minutes in the future',
    );
  }
}
