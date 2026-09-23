import type { Status } from '../types.js';

export const emptyForm = {
  styleNumber: '',
  styleName: '',
  description: '',
  categoryDescription: '',
  itemNameGroup: '',
  ipName: '',
  licensor: '',
  colour: '',
  lmixNumber: '',
  hsnCode: '',
  hsnDescription: '',
  finalMrp: '',
  royaltyPercentage: '',
  status: 'ACTIVE' as Status,
};

export type StyleFormFields = typeof emptyForm;
export type StyleFieldKey = keyof StyleFormFields;

export const fieldLabels: Record<StyleFieldKey, string> = {
  styleNumber: 'Style Number',
  styleName: 'Style Name',
  description: 'Description',
  categoryDescription: 'Category',
  itemNameGroup: 'Item Name Group',
  ipName: 'IP Name',
  licensor: 'Licensor',
  colour: 'Colour',
  lmixNumber: 'LMIX Number',
  hsnCode: 'HSN Code',
  hsnDescription: 'HSN Description',
  finalMrp: 'Final MRP',
  royaltyPercentage: 'Royalty %',
  status: 'Status',
};

// Identity & Classification vs Commercial & Tax: separates a Style's product
// identity from its pricing/statutory fields so the two concerns aren't read
// as one undifferentiated block (U2 Style Master UX restructure). 'season' is
// not a key of StyleFormFields — it's rendered specially by
// StyleIdentitySection since Season is a separate SelectField backed by its
// own query, not a plain text/status field.
export const identityFieldLayout = [
  { key: 'styleNumber', width: 'sm' },
  { key: 'styleName', width: 'md' },
  { key: 'lmixNumber', width: 'sm' },
  { key: 'season', width: 'md' },
  { key: 'status', width: 'sm' },
  { key: 'categoryDescription', width: 'sm' },
  { key: 'itemNameGroup', width: 'md' },
  { key: 'ipName', width: 'sm' },
  { key: 'licensor', width: 'md' },
  { key: 'colour', width: 'sm' },
  { key: 'description', width: 'lg' },
] as const;

export const commercialFieldLayout = [
  { key: 'finalMrp', width: 'sm' },
  { key: 'royaltyPercentage', width: 'xs' },
  { key: 'hsnCode', width: 'sm' },
  { key: 'hsnDescription', width: 'lg' },
] as const;

export const HSN_CODE_PATTERN = /^\d{8}$/;
export const isValidHsnCode = (value: string) => !value || HSN_CODE_PATTERN.test(value);

/** Same field-level error rules the form used pre-restructure, just relocated so both the
 * Identity and Commercial sections can each ask "does my own field have an error" without
 * duplicating the checks. */
export function styleFieldErrorMessage(
  key: StyleFieldKey,
  form: StyleFormFields,
  hasError: boolean,
): string | undefined {
  if (!hasError) return undefined;
  if (key === 'hsnCode' && !isValidHsnCode(form.hsnCode)) return 'HSN Code must be exactly 8 digits';
  if (key === 'styleNumber' && !form.styleNumber) return 'Required';
  if (key === 'styleName' && !form.styleName) return 'Required';
  return undefined;
}

/** Identical checks/messages to the pre-restructure inline mutation validation — relocated, not
 * changed, so it can be unit tested directly and reused verbatim from StyleFormPage's mutationFn. */
export function validateStyleForm(form: StyleFormFields, seasonId: string): string | null {
  if (!isValidHsnCode(form.hsnCode)) {
    return 'HSN Code must be exactly 8 digits.';
  }
  if (!form.styleNumber || !form.styleName || Number(form.finalMrp) <= 0 || !seasonId) {
    return 'Style number, style name, final MRP, and Season are required';
  }
  return null;
}

export function cleanPayload(form: StyleFormFields, seasonId: string) {
  return {
    ...form,
    finalMrp: Number(form.finalMrp),
    royaltyPercentage: form.royaltyPercentage === '' ? null : Number(form.royaltyPercentage),
    seasonId,
  };
}
