import { describe, expect, it } from 'vitest';
import {
  closeEwayBillDemoAttemptSchema,
  generateEwayBillDemoSchema,
  linkEwayBillSchema,
  updateEwayBillMovementSchema,
} from './eway-bill-operations.validation.js';

const FORBIDDEN_KEYS = ['mode', 'test_mode', 'testMode', 'integrationMode', 'gstin_username', 'password', 'apiKey', 'source', 'verificationStatus', 'outcome'];

describe('strict request schemas', () => {
  const valid = {
    movement: { expectedVersion: 0 },
    generate: { expectedMovementVersion: 1 },
    close: { expectedOutcome: 'UNCERTAIN', reason: 'A real reason for closing' },
    link: { ewayBillNumber: '123456789012' },
  };
  const schemas = {
    movement: updateEwayBillMovementSchema,
    generate: generateEwayBillDemoSchema,
    close: closeEwayBillDemoAttemptSchema,
    link: linkEwayBillSchema,
  } as const;

  for (const name of Object.keys(schemas) as Array<keyof typeof schemas>) {
    it(`${name}: accepts the minimal valid body`, () => {
      expect(schemas[name].safeParse(valid[name]).success).toBe(true);
    });
    it.each(FORBIDDEN_KEYS)(`${name}: rejects a client-supplied %s`, (key) => {
      expect(schemas[name].safeParse({ ...valid[name], [key]: 'LIVE' }).success).toBe(false);
    });
  }
});

describe('movement schema', () => {
  const parse = (body: Record<string, unknown>) => updateEwayBillMovementSchema.parse({ expectedVersion: 1, ...body });

  it('stores every omitted field as null (PUT replaces)', () => {
    expect(parse({})).toEqual({
      expectedVersion: 1,
      transportMode: undefined,
      vehicleNumber: null,
      vehicleType: undefined,
      transporterId: null,
      transporterName: null,
      transportDocumentNumber: null,
      transportDocumentDate: undefined,
      approximateDistanceKm: undefined,
      shipToArrangement: undefined,
      dispatchFromArrangement: undefined,
      dispatchFrom: undefined,
    });
  });

  it('keeps a distance of 0 and bounds it to NIC range', () => {
    expect(parse({ approximateDistanceKm: 0 }).approximateDistanceKm).toBe(0);
    expect(parse({ approximateDistanceKm: 4000 }).approximateDistanceKm).toBe(4000);
    expect(() => parse({ approximateDistanceKm: 4001 })).toThrow();
    expect(() => parse({ approximateDistanceKm: -1 })).toThrow();
    expect(() => parse({ approximateDistanceKm: 1.5 })).toThrow();
  });

  it('normalises vehicle number and transporter id and blanks to null', () => {
    expect(parse({ vehicleNumber: ' tn 01-ab 1234 ' }).vehicleNumber).toBe('TN 01-AB 1234');
    expect(parse({ vehicleNumber: '   ' }).vehicleNumber).toBeNull();
    expect(parse({ transporterId: '33abcde1234f1z5' }).transporterId).toBe('33ABCDE1234F1Z5');
    expect(parse({ transportDocumentNumber: '' }).transportDocumentNumber).toBeNull();
  });

  it.each([
    [{ vehicleNumber: 'AB1' }],
    [{ vehicleNumber: 'TN01AB1234567890' }],
    [{ transporterId: 'short' }],
    [{ transportDocumentNumber: 'WAY TOO LONG A NUMBER' }],
    [{ transportDocumentDate: '2026-02-30' }],
    [{ transportDocumentDate: '04/11/2026' }],
    [{ transportMode: 'DRONE' }],
    [{ vehicleType: 'TRUCK' }],
    [{ shipToArrangement: 'SOMEONE' }],
    [{ dispatchFromArrangement: 'ELSEWHERE' }],
    [{ dispatchFrom: { postalCode: '12345' } }],
    [{ dispatchFrom: { stateCode: '3' } }],
    [{ dispatchFrom: { unknown: 'x' } }],
    [{ transporterName: 'x'.repeat(101) }],
  ])('rejects malformed input %j', (body) => {
    expect(() => parse(body)).toThrow();
  });

  it('accepts a complete dispatch-from address and a valid transport document date', () => {
    const parsed = parse({
      transportDocumentDate: '2026-11-04',
      dispatchFrom: { addressLine1: 'Dock 4', city: 'Hosur', state: 'Tamil Nadu', stateCode: '33', postalCode: '635109' },
    });
    expect(parsed.transportDocumentDate).toBe('2026-11-04');
    expect(parsed.dispatchFrom).toMatchObject({ postalCode: '635109', addressLine2: null });
  });

  it('rejects a missing or negative expected version', () => {
    expect(() => updateEwayBillMovementSchema.parse({})).toThrow();
    expect(() => updateEwayBillMovementSchema.parse({ expectedVersion: -1 })).toThrow();
  });
});

describe('close and link schemas', () => {
  it('limits the outcomes that can be closed to the open ones', () => {
    for (const expectedOutcome of ['SUCCEEDED', 'REJECTED', 'CLOSED']) {
      expect(closeEwayBillDemoAttemptSchema.safeParse({ expectedOutcome, reason: 'A real reason for closing' }).success).toBe(false);
    }
  });

  it('trims the reason and requires at least 10 characters', () => {
    expect(closeEwayBillDemoAttemptSchema.parse({ expectedOutcome: 'DISPATCHED', reason: '  stalled; confirmed demo only  ' }).reason).toBe('stalled; confirmed demo only');
    expect(closeEwayBillDemoAttemptSchema.safeParse({ expectedOutcome: 'DISPATCHED', reason: '   short   ' }).success).toBe(false);
  });

  it('accepts exactly 12 digits and nothing that looks synthetic', () => {
    expect(linkEwayBillSchema.parse({ ewayBillNumber: ' 123456789012 ' }).ewayBillNumber).toBe('123456789012');
    for (const ewayBillNumber of ['TEST-100000000001', 'test-1', '12345678901', '1234567890123', '12345678901a', '1234 5678 9012', '']) {
      expect(linkEwayBillSchema.safeParse({ ewayBillNumber }).success).toBe(false);
    }
  });
});
