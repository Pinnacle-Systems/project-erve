import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import { resetDatabase } from '../test/helpers.js';
import { ensureFinancialYear } from '../modules/master-data/financial-year.service.js';
import { allocateDocumentSerial } from '../modules/master-data/document-sequence.service.js';
import { runDocumentSequenceBaseline } from './document-sequence-baseline.js';

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('runDocumentSequenceBaseline', () => {
  it('raises a sequence baseline above its current value', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2034-06-01'));
    const result = await runDocumentSequenceBaseline({
      documentType: 'PURCHASE_ORDER',
      financialYearCode: fy.code,
      approvedLastAllocatedSerial: 68,
    });
    expect(result).toMatchObject({ previous: 0, current: 68, changed: true });

    const sequence = await prisma.documentSequence.findUniqueOrThrow({
      where: { documentType_financialYearId: { documentType: 'PURCHASE_ORDER', financialYearId: fy.id } },
    });
    expect(sequence.lastAllocatedSerial).toBe(68);
  });

  it('is a no-op when the requested value equals the current baseline', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2034-06-01'));
    await runDocumentSequenceBaseline({
      documentType: 'PURCHASE_ORDER',
      financialYearCode: fy.code,
      approvedLastAllocatedSerial: 68,
    });
    const result = await runDocumentSequenceBaseline({
      documentType: 'PURCHASE_ORDER',
      financialYearCode: fy.code,
      approvedLastAllocatedSerial: 68,
    });
    expect(result).toMatchObject({ previous: 68, current: 68, changed: false });
  });

  it('never decreases a sequence', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2034-06-01'));
    await runDocumentSequenceBaseline({
      documentType: 'PURCHASE_ORDER',
      financialYearCode: fy.code,
      approvedLastAllocatedSerial: 68,
    });
    await expect(
      runDocumentSequenceBaseline({
        documentType: 'PURCHASE_ORDER',
        financialYearCode: fy.code,
        approvedLastAllocatedSerial: 10,
      }),
    ).rejects.toThrow(/never decreased/i);

    const sequence = await prisma.documentSequence.findUniqueOrThrow({
      where: { documentType_financialYearId: { documentType: 'PURCHASE_ORDER', financialYearId: fy.id } },
    });
    expect(sequence.lastAllocatedSerial).toBe(68);
  });

  it('the next real allocation continues from the raised baseline, not the pre-baseline high-water mark', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2034-06-01'));
    await runDocumentSequenceBaseline({
      documentType: 'PURCHASE_ORDER',
      financialYearCode: fy.code,
      approvedLastAllocatedSerial: 68,
    });
    const nextSerial = await prisma.$transaction((tx) =>
      allocateDocumentSerial(tx, 'PURCHASE_ORDER', fy.id),
    );
    expect(nextSerial).toBe(69);
  });

  it('keeps PURCHASE_ORDER and JOB_ORDER sequences independent for the same Financial Year', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2034-06-01'));
    await runDocumentSequenceBaseline({
      documentType: 'PURCHASE_ORDER',
      financialYearCode: fy.code,
      approvedLastAllocatedSerial: 68,
    });
    const jobOrderSequence = await prisma.documentSequence.findUnique({
      where: { documentType_financialYearId: { documentType: 'JOB_ORDER', financialYearId: fy.id } },
    });
    expect(jobOrderSequence).toBeNull();
  });
});
