import { describe, expect, it } from 'vitest';
import { queryBooleanSchema } from './query-boolean.js';

describe('queryBooleanSchema', () => {
  it('parses the literal string "true" as true', () => {
    expect(queryBooleanSchema.parse('true')).toBe(true);
  });

  it('parses the literal string "false" as false — unlike z.coerce.boolean()', () => {
    expect(queryBooleanSchema.parse('false')).toBe(false);
  });

  it('rejects any other string', () => {
    expect(() => queryBooleanSchema.parse('0')).toThrow();
    expect(() => queryBooleanSchema.parse('1')).toThrow();
    expect(() => queryBooleanSchema.parse('')).toThrow();
    expect(() => queryBooleanSchema.parse('False')).toThrow();
  });
});
