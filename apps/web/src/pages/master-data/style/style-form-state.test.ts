import { describe, expect, it } from 'vitest';
import {
  cleanPayload,
  emptyForm,
  isValidHsnCode,
  styleFieldErrorMessage,
  validateStyleForm,
} from './style-form-state.js';

describe('isValidHsnCode', () => {
  it('accepts an empty value (optional field)', () => {
    expect(isValidHsnCode('')).toBe(true);
  });
  it('accepts exactly 8 digits', () => {
    expect(isValidHsnCode('12345678')).toBe(true);
  });
  it('rejects anything else', () => {
    expect(isValidHsnCode('1234567')).toBe(false);
    expect(isValidHsnCode('123456789')).toBe(false);
    expect(isValidHsnCode('abcd5678')).toBe(false);
  });
});

describe('validateStyleForm', () => {
  const validForm = { ...emptyForm, styleNumber: 'STY-1', styleName: 'Tee', finalMrp: '100' };

  it('passes for a fully valid form', () => {
    expect(validateStyleForm(validForm, 'season-1')).toBeNull();
  });

  it('requires an 8-digit HSN code when one is entered', () => {
    expect(validateStyleForm({ ...validForm, hsnCode: '123' }, 'season-1')).toBe(
      'HSN Code must be exactly 8 digits.',
    );
  });

  it('requires style number, style name, a positive final MRP and a season', () => {
    const message = 'Style number, style name, final MRP, and Season are required';
    expect(validateStyleForm({ ...validForm, styleNumber: '' }, 'season-1')).toBe(message);
    expect(validateStyleForm({ ...validForm, styleName: '' }, 'season-1')).toBe(message);
    expect(validateStyleForm({ ...validForm, finalMrp: '0' }, 'season-1')).toBe(message);
    expect(validateStyleForm(validForm, '')).toBe(message);
  });
});

describe('styleFieldErrorMessage', () => {
  const form = { ...emptyForm };

  it('returns undefined when there is no active error', () => {
    expect(styleFieldErrorMessage('styleNumber', form, false)).toBeUndefined();
  });

  it('flags a missing required field once an error is active', () => {
    expect(styleFieldErrorMessage('styleNumber', form, true)).toBe('Required');
    expect(styleFieldErrorMessage('styleName', form, true)).toBe('Required');
  });

  it('flags an invalid HSN code once an error is active', () => {
    expect(styleFieldErrorMessage('hsnCode', { ...form, hsnCode: '123' }, true)).toBe(
      'HSN Code must be exactly 8 digits',
    );
  });

  it('leaves unrelated fields alone', () => {
    expect(styleFieldErrorMessage('colour', form, true)).toBeUndefined();
  });
});

describe('cleanPayload', () => {
  it('coerces MRP/royalty to numbers and attaches the season id', () => {
    const payload = cleanPayload(
      { ...emptyForm, finalMrp: '499', royaltyPercentage: '5' },
      'season-1',
    );
    expect(payload.finalMrp).toBe(499);
    expect(payload.royaltyPercentage).toBe(5);
    expect(payload.seasonId).toBe('season-1');
  });

  it('sends null royalty when left blank', () => {
    const payload = cleanPayload({ ...emptyForm, finalMrp: '499' }, 'season-1');
    expect(payload.royaltyPercentage).toBeNull();
  });
});
