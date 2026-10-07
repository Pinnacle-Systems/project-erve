import type { Status } from '../types.js';
import type { StyleFactoryMappingRow } from './StyleFactoryMappingsField.js';

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

// 'hsn' is not a key of StyleFormFields either — same reason as 'season'
// above: it's a SelectField sourced from GET /hsns/options (INV-002 review
// correction: Style selects an Hsn master record, it no longer accepts
// free-text hsnCode/hsnDescription), rendered specially by
// StyleCommercialSection.
export const commercialFieldLayout = [
  { key: 'finalMrp', width: 'sm' },
  { key: 'royaltyPercentage', width: 'xs' },
  { key: 'hsn', width: 'lg' },
] as const;

/** Same field-level error rules the form used pre-restructure, just relocated so both the
 * Identity and Commercial sections can each ask "does my own field have an error" without
 * duplicating the checks. */
export function styleFieldErrorMessage(
  key: StyleFieldKey,
  form: StyleFormFields,
  hasError: boolean,
): string | undefined {
  if (!hasError) return undefined;
  if (key === 'styleNumber' && !form.styleNumber) return 'Required';
  if (key === 'styleName' && !form.styleName) return 'Required';
  if (key === 'finalMrp' && Number(form.finalMrp) <= 0) return 'Required';
  return undefined;
}

/** Identical checks/messages to the pre-restructure inline mutation validation — relocated, not
 * changed, so it can be unit tested directly and reused verbatim from StyleFormPage's mutationFn. */
export function validateStyleForm(form: StyleFormFields, seasonId: string): string | null {
  if (!form.styleNumber || !form.styleName || Number(form.finalMrp) <= 0 || !seasonId) {
    return 'Style number, style name, final MRP, and Season are required';
  }
  return null;
}

export function cleanPayload(form: StyleFormFields, seasonId: string, hsnId: string | null) {
  return {
    ...form,
    finalMrp: Number(form.finalMrp),
    royaltyPercentage: form.royaltyPercentage === '' ? null : Number(form.royaltyPercentage),
    seasonId,
    hsnId,
  };
}

/**
 * Request item for one Style + Size. A blank barcode is omitted so the server
 * generates it; a typed one is sent as a manual override (trimmed). The web
 * never computes a barcode itself.
 */
export function toStyleSizeRequest(sizeId: string, barcodeBySizeId: Record<string, string>) {
  const barcode = (barcodeBySizeId[sizeId] ?? '').trim();
  return barcode === '' ? { sizeId } : { sizeId, barcode };
}

/**
 * Request item for the Style's complete desired Factory-mapping set (SESS-008): rows without a
 * selected factory are blank "add another" placeholders, never sent.
 */
export function toStyleFactoryMappingRequests(mappings: StyleFactoryMappingRow[]) {
  return mappings
    .filter((mapping) => mapping.factoryId)
    .map((mapping) => ({ factoryId: mapping.factoryId, exFactoryPrice: Number(mapping.exFactoryPrice) }));
}
