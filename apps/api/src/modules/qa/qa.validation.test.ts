import { describe, expect, it } from 'vitest';
import { saveSizeInspectionFormSchema } from './qa.validation.js';
import { QA_CHECKLIST_ITEMS } from '@erve/types';

const form = {
  jobOrderLineSizeId: 'job-order-line-size-id',
  inspectedQuantity: 3,
  acceptedQuantity: 3,
  reworkQuantity: 0,
  permanentlyRejectedQuantity: 0,
  sampleQuantity: 2,
  checklist: QA_CHECKLIST_ITEMS.map((item) => ({ itemCode: item.code, status: null, remarks: null })),
};

describe('QA inspection form validation', () => {
  it('accepts only supplied checklist codes and mark columns', () => {
    expect(
      saveSizeInspectionFormSchema.safeParse({
        expectedVersion: 1,
        ...form,
        checklist: form.checklist.map((item) =>
          item.itemCode === 'FABRIC_GSM' ? { ...item, status: 'YES', remarks: '177 GSM' } : item,
        ),
      }).success,
    ).toBe(true);
  });

  it('rejects duplicate form checks and unsafe sample quantities', () => {
    expect(
      saveSizeInspectionFormSchema.safeParse({
        expectedVersion: 1,
        ...form,
        sampleQuantity: -1,
      }).success,
    ).toBe(false);
  });

  it('accepts incomplete defect details in a draft payload', () => {
    expect(
      saveSizeInspectionFormSchema.safeParse({
        expectedVersion: 1,
        ...form,
        acceptedQuantity: 2,
        reworkQuantity: 1,
        defectCategory: null,
      }).success,
    ).toBe(true);
    expect(
      saveSizeInspectionFormSchema.safeParse({
        expectedVersion: 1,
        ...form,
        acceptedQuantity: 2,
        reworkQuantity: 1,
        defectCategory: 'OTHER',
        otherDefectDetails: null,
      }).success,
    ).toBe(true);
  });
});
