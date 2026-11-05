import { describe, expect, it } from 'vitest';
import {
  createCredential,
  decryptCredential,
  digest,
  parseDeliveryConfig,
  deliveryInputSchema,
  validateDeliveryTime,
} from './carton-delivery.security.js';

const configuration = {
  enabled: true,
  origin: 'https://deliver.example',
  activeKey: 'v1',
  keys: JSON.stringify({ v1: Buffer.alloc(32, 7).toString('base64') }),
  validityDays: 180,
};
describe('carton delivery capability security', () => {
  it('fails closed on invalid origin or key configuration, and stays optional when disabled', () => {
    expect(parseDeliveryConfig({ ...configuration, enabled: false, keys: '' }).enabled).toBe(false);
    for (const origin of [
      'http://deliver.example',
      'https://u:p@deliver.example',
      'https://deliver.example/path',
      'https://deliver.example?q=x',
    ]) {
      expect(() => parseDeliveryConfig({ ...configuration, origin })).toThrow();
    }
    expect(() => parseDeliveryConfig({ ...configuration, keys: '{}' })).toThrow();
  });
  it('creates different 256-bit credentials and reproduces the original with authenticated encryption', () => {
    const config = parseDeliveryConfig(configuration);
    const first = createCredential(config, 'carton-one');
    const second = createCredential(config, 'carton-two');
    expect(Buffer.from(first.token, 'base64url')).toHaveLength(32);
    expect(second.token).not.toBe(first.token);
    expect(first.tokenDigest).toBe(digest(first.token));
    expect(first.encryptedToken).not.toContain(first.token);
    expect(decryptCredential(config, first, 'carton-one')).toBe(first.token);
    expect(() => decryptCredential(config, first, 'carton-two')).toThrow();
    expect(() =>
      decryptCredential(
        config,
        { ...first, encryptedToken: first.encryptedToken.slice(0, -3) + 'AAA' },
        'carton-one',
      ),
    ).toThrow();
    const rotated = parseDeliveryConfig({
      ...configuration,
      activeKey: 'v2',
      keys: JSON.stringify({
        v1: Buffer.alloc(32, 7).toString('base64'),
        v2: Buffer.alloc(32, 8).toString('base64'),
      }),
    });
    expect(decryptCredential(rotated, first, 'carton-one')).toBe(first.token);
  });
  it('strictly bounds submitted evidence and requires explicit confirmation and an offset', () => {
    const input = {
      recipientName: ' Recipient ',
      deliveredAt: '2026-11-05T12:30:00+05:30',
      timezone: 'Asia/Kolkata',
      offsetMinutes: 330,
      remarks: '',
      confirmed: true,
      idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
    };
    expect(deliveryInputSchema.parse(input).recipientName).toBe('Recipient');
    for (const changes of [
      { recipientName: ' ' },
      { recipientName: 'x'.repeat(121) },
      { remarks: 'x'.repeat(2001) },
      { confirmed: false },
      { deliveredAt: '2026-11-05T12:30' },
      { cartonId: 'other' },
      { timezone: 'invalid/timezone' },
    ]) {
      expect(deliveryInputSchema.safeParse({ ...input, ...changes }).success).toBe(false);
    }
  });
  it('uses the Indian Dispatch calendar date and permits only five minutes future clock skew', () => {
    const now = new Date('2026-11-05T07:00:00Z');
    const dispatchDate = new Date('2026-11-05T00:00:00Z');
    expect(() =>
      validateDeliveryTime(new Date('2026-11-04T18:30:00Z'), dispatchDate, now),
    ).not.toThrow();
    expect(() =>
      validateDeliveryTime(new Date('2026-11-04T18:29:59Z'), dispatchDate, now),
    ).toThrow();
    expect(() =>
      validateDeliveryTime(new Date('2026-11-05T07:05:00Z'), dispatchDate, now),
    ).not.toThrow();
    expect(() =>
      validateDeliveryTime(new Date('2026-11-05T07:05:01Z'), dispatchDate, now),
    ).toThrow();
  });
});
