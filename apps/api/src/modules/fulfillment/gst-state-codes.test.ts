import { describe, expect, it } from 'vitest';
import { resolveGstStateCode } from '@erve/shared';

describe('resolveGstStateCode', () => {
  it('resolves canonical state names to their GST state code', () => {
    expect(resolveGstStateCode('Tamil Nadu')).toBe('33');
    expect(resolveGstStateCode('Karnataka')).toBe('29');
    expect(resolveGstStateCode('Maharashtra')).toBe('27');
    expect(resolveGstStateCode('Ladakh')).toBe('38');
  });

  it('normalizes case and surrounding whitespace', () => {
    expect(resolveGstStateCode('  tamil nadu  ')).toBe('33');
    expect(resolveGstStateCode('TAMIL NADU')).toBe('33');
  });

  it('resolves documented aliases only', () => {
    expect(resolveGstStateCode('Orissa')).toBe('21');
    expect(resolveGstStateCode('Pondicherry')).toBe('34');
    expect(resolveGstStateCode('Jammu & Kashmir')).toBe('01');
  });

  it('returns null for unrecognized input rather than guessing', () => {
    expect(resolveGstStateCode('Tamilnadu')).toBeNull(); // no fuzzy matching
    expect(resolveGstStateCode('TN')).toBeNull();
    expect(resolveGstStateCode('')).toBeNull();
    expect(resolveGstStateCode(null)).toBeNull();
    expect(resolveGstStateCode(undefined)).toBeNull();
    expect(resolveGstStateCode('Not A Real State')).toBeNull();
  });
});
