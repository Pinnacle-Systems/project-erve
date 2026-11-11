import { describe, expect, it } from 'vitest';
import type { Role } from '@erve/types';
import { canSubmitRetailStoreFifoAction } from '@erve/shared';

// ISS-089 / A7: Store-level Report Sold / Request Return are for Distributor-only users.
describe('canSubmitRetailStoreFifoAction', () => {
  it.each([
    [['DISTRIBUTOR'], true],
    [['ADMIN'], false],
    [['ADMIN', 'DISTRIBUTOR'], false],
    [['DISTRIBUTOR', 'ADMIN'], false],
    [['MERCHANDISER'], false],
    [['DISTRIBUTOR', 'MERCHANDISER'], false],
    [['FACTORY_USER'], false],
    [['DISTRIBUTOR', 'FACTORY_USER'], false],
    [['TRANSPORTER'], false],
    [['DISTRIBUTOR', 'TRANSPORTER'], false],
    [['ACCOUNTANT'], false],
    [['SENIOR_MANAGEMENT'], false],
    [[], false],
  ] as Array<[Role[], boolean]>)('%j -> %s', (roles, expected) => {
    expect(canSubmitRetailStoreFifoAction({ roles })).toBe(expected);
  });
});
