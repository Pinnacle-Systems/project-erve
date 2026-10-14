import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import {
  resetDatabase,
  createTestTaxInvoice,
} from '../test/helpers.js';
import { ensureFinancialYear } from '../modules/master-data/financial-year.service.js';
import { allocateDocumentSerial, setDocumentSequenceBaseline } from '../modules/master-data/document-sequence.service.js';
import { formatDocumentNumber } from '../modules/master-data/document-number.util.js';
import { runDocumentSequenceBaseline } from './document-sequence-baseline.js';

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('runDocumentSequenceBaseline', () => {
  it('fresh sequence initialization with baseline 0 creates the sequence row and allows first allocation to be 1', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2034-06-01'));

    // Sequence row does not exist prior to baseline run
    const seqBefore = await prisma.documentSequence.findUnique({
      where: { documentType_financialYearId: { documentType: 'TAX_INVOICE', financialYearId: fy.id } },
    });
    expect(seqBefore).toBeNull();

    const result = await runDocumentSequenceBaseline({
      documentType: 'TAX_INVOICE',
      financialYearCode: fy.code,
      approvedLastAllocatedSerial: 0,
    });

    expect(result).toMatchObject({
      documentType: 'TAX_INVOICE',
      financialYearCode: fy.code,
      previous: 0,
      current: 0,
      changed: true,
      created: true,
    });

    // Sequence row now exists in the database with lastAllocatedSerial = 0
    const sequence = await prisma.documentSequence.findUniqueOrThrow({
      where: { documentType_financialYearId: { documentType: 'TAX_INVOICE', financialYearId: fy.id } },
    });
    expect(sequence.lastAllocatedSerial).toBe(0);

    // The first allocation increments 0 -> 1
    const nextSerial = await prisma.$transaction((tx) =>
      allocateDocumentSerial(tx, 'TAX_INVOICE', fy.id),
    );
    expect(nextSerial).toBe(1);

    const invoiceNumber = formatDocumentNumber('EI', fy.code, nextSerial);
    expect(invoiceNumber).toBe(`EI/34-35/0001`);
  });

  it('fresh sequence initialization with a positive serial sets the baseline and next allocation continues from baseline + 1', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2034-06-01'));

    const result = await runDocumentSequenceBaseline({
      documentType: 'TAX_INVOICE',
      financialYearCode: fy.code,
      approvedLastAllocatedSerial: 100,
    });

    expect(result).toMatchObject({
      previous: 0,
      current: 100,
      changed: true,
      created: true,
    });

    const sequence = await prisma.documentSequence.findUniqueOrThrow({
      where: { documentType_financialYearId: { documentType: 'TAX_INVOICE', financialYearId: fy.id } },
    });
    expect(sequence.lastAllocatedSerial).toBe(100);

    const nextSerial = await prisma.$transaction((tx) =>
      allocateDocumentSerial(tx, 'TAX_INVOICE', fy.id),
    );
    expect(nextSerial).toBe(101);

    const invoiceNumber = formatDocumentNumber('EI', fy.code, nextSerial);
    expect(invoiceNumber).toBe(`EI/34-35/0101`);
  });

  it('existing sequence advanced to a higher serial updates lastAllocatedSerial', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2034-06-01'));

    await runDocumentSequenceBaseline({
      documentType: 'PURCHASE_ORDER',
      financialYearCode: fy.code,
      approvedLastAllocatedSerial: 50,
    });

    const result = await runDocumentSequenceBaseline({
      documentType: 'PURCHASE_ORDER',
      financialYearCode: fy.code,
      approvedLastAllocatedSerial: 150,
    });

    expect(result).toMatchObject({
      previous: 50,
      current: 150,
      changed: true,
      created: false,
    });

    const nextSerial = await prisma.$transaction((tx) =>
      allocateDocumentSerial(tx, 'PURCHASE_ORDER', fy.id),
    );
    expect(nextSerial).toBe(151);
  });

  it('same baseline applied twice is idempotent and reports no-op', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2034-06-01'));

    // First run with 0 creates row
    const firstResult = await runDocumentSequenceBaseline({
      documentType: 'TAX_INVOICE',
      financialYearCode: fy.code,
      approvedLastAllocatedSerial: 0,
    });
    expect(firstResult).toMatchObject({ previous: 0, current: 0, changed: true, created: true });

    // Second run with 0 is an idempotent no-op
    const secondResult = await runDocumentSequenceBaseline({
      documentType: 'TAX_INVOICE',
      financialYearCode: fy.code,
      approvedLastAllocatedSerial: 0,
    });
    expect(secondResult).toMatchObject({ previous: 0, current: 0, changed: false, created: false });

    // Advance to 100
    await runDocumentSequenceBaseline({
      documentType: 'TAX_INVOICE',
      financialYearCode: fy.code,
      approvedLastAllocatedSerial: 100,
    });

    // Repeating 100 is also an idempotent no-op
    const repeatResult = await runDocumentSequenceBaseline({
      documentType: 'TAX_INVOICE',
      financialYearCode: fy.code,
      approvedLastAllocatedSerial: 100,
    });
    expect(repeatResult).toMatchObject({ previous: 100, current: 100, changed: false, created: false });
  });

  it('attempt to decrease a sequence is rejected', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2034-06-01'));

    await runDocumentSequenceBaseline({
      documentType: 'TAX_INVOICE',
      financialYearCode: fy.code,
      approvedLastAllocatedSerial: 100,
    });

    await expect(
      runDocumentSequenceBaseline({
        documentType: 'TAX_INVOICE',
        financialYearCode: fy.code,
        approvedLastAllocatedSerial: 50,
      }),
    ).rejects.toThrow(/Refusing to lower TAX_INVOICE sequence for FY 2034-35 from 100 to 50 — sequences are never decreased/);

    const sequence = await prisma.documentSequence.findUniqueOrThrow({
      where: { documentType_financialYearId: { documentType: 'TAX_INVOICE', financialYearId: fy.id } },
    });
    expect(sequence.lastAllocatedSerial).toBe(100);
  });

  it('attempt to initialize behind existing invoice records fails safely (high-water-mark collision prevention)', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2034-06-01'));
    await createTestTaxInvoice({
      financialYearId: fy.id,
      invoiceNumber: 'EI/34-35/0075',
    });

    // Attempting to set baseline behind existing record (e.g. 50 < 75) must fail
    await expect(
      runDocumentSequenceBaseline({
        documentType: 'TAX_INVOICE',
        financialYearCode: fy.code,
        approvedLastAllocatedSerial: 50,
      }),
    ).rejects.toThrow(/existing TAX_INVOICE records in this financial year have reached serial 75.*baseline cannot be set behind existing records/);

    // Setting baseline equal to or above 75 succeeds
    const okResult = await runDocumentSequenceBaseline({
      documentType: 'TAX_INVOICE',
      financialYearCode: fy.code,
      approvedLastAllocatedSerial: 75,
    });
    expect(okResult.current).toBe(75);

    // Next allocation safely receives 76, avoiding any collision with 75
    const nextSerial = await prisma.$transaction((tx) =>
      allocateDocumentSerial(tx, 'TAX_INVOICE', fy.id),
    );
    expect(nextSerial).toBe(76);
  });

  it('financial-year isolation keeps sequences completely separate across financial years', async () => {
    const fy1 = await ensureFinancialYear(prisma, new Date('2034-06-01')); // 2034-35
    const fy2 = await ensureFinancialYear(prisma, new Date('2035-06-01')); // 2035-36

    await runDocumentSequenceBaseline({
      documentType: 'TAX_INVOICE',
      financialYearCode: fy1.code,
      approvedLastAllocatedSerial: 500,
    });

    const seq1 = await prisma.documentSequence.findUnique({
      where: { documentType_financialYearId: { documentType: 'TAX_INVOICE', financialYearId: fy1.id } },
    });
    const seq2 = await prisma.documentSequence.findUnique({
      where: { documentType_financialYearId: { documentType: 'TAX_INVOICE', financialYearId: fy2.id } },
    });

    expect(seq1?.lastAllocatedSerial).toBe(500);
    expect(seq2).toBeNull(); // FY2 has not been touched

    // Baseline FY2 at 0
    await runDocumentSequenceBaseline({
      documentType: 'TAX_INVOICE',
      financialYearCode: fy2.code,
      approvedLastAllocatedSerial: 0,
    });

    const nextFY1 = await prisma.$transaction((tx) => allocateDocumentSerial(tx, 'TAX_INVOICE', fy1.id));
    const nextFY2 = await prisma.$transaction((tx) => allocateDocumentSerial(tx, 'TAX_INVOICE', fy2.id));

    expect(nextFY1).toBe(501);
    expect(nextFY2).toBe(1);
  });

  it('document-type isolation maintains independent counters for PURCHASE_ORDER, JOB_ORDER, and TAX_INVOICE', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2034-06-01'));

    await runDocumentSequenceBaseline({
      documentType: 'PURCHASE_ORDER',
      financialYearCode: fy.code,
      approvedLastAllocatedSerial: 10,
    });

    await runDocumentSequenceBaseline({
      documentType: 'JOB_ORDER',
      financialYearCode: fy.code,
      approvedLastAllocatedSerial: 20,
    });

    await runDocumentSequenceBaseline({
      documentType: 'TAX_INVOICE',
      financialYearCode: fy.code,
      approvedLastAllocatedSerial: 30,
    });

    const nextPo = await prisma.$transaction((tx) => allocateDocumentSerial(tx, 'PURCHASE_ORDER', fy.id));
    const nextJo = await prisma.$transaction((tx) => allocateDocumentSerial(tx, 'JOB_ORDER', fy.id));
    const nextTi = await prisma.$transaction((tx) => allocateDocumentSerial(tx, 'TAX_INVOICE', fy.id));

    expect(nextPo).toBe(11);
    expect(nextJo).toBe(21);
    expect(nextTi).toBe(31);
  });

  it('dryRun mode verifies baseline operation without committing any changes', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2034-06-01'));

    const dryResult = await runDocumentSequenceBaseline({
      documentType: 'TAX_INVOICE',
      financialYearCode: fy.code,
      approvedLastAllocatedSerial: 200,
      dryRun: true,
    });

    expect(dryResult).toMatchObject({
      documentType: 'TAX_INVOICE',
      financialYearCode: fy.code,
      previous: 0,
      current: 200,
      changed: true,
      created: true,
    });

    // Sequence row must NOT exist in the database after dry-run
    const sequence = await prisma.documentSequence.findUnique({
      where: { documentType_financialYearId: { documentType: 'TAX_INVOICE', financialYearId: fy.id } },
    });
    expect(sequence).toBeNull();
  });

  it('failed transaction rolls back cleanly without partial sequence mutation', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2034-06-01'));

    await expect(
      prisma.$transaction(async (tx) => {
        await setDocumentSequenceBaseline(tx, 'TAX_INVOICE', fy.code, 100);
        throw new Error('Simulated failure during multi-step operation');
      }),
    ).rejects.toThrow('Simulated failure during multi-step operation');

    // Sequence row must not exist due to transactional rollback
    const sequence = await prisma.documentSequence.findUnique({
      where: { documentType_financialYearId: { documentType: 'TAX_INVOICE', financialYearId: fy.id } },
    });
    expect(sequence).toBeNull();
  });

  it('serializes concurrent baseline operations through pg_advisory_xact_lock', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2034-06-01'));

    // Execute multiple sequential and concurrent requests
    const p1 = runDocumentSequenceBaseline({
      documentType: 'TAX_INVOICE',
      financialYearCode: fy.code,
      approvedLastAllocatedSerial: 50,
    });
    const p2 = runDocumentSequenceBaseline({
      documentType: 'TAX_INVOICE',
      financialYearCode: fy.code,
      approvedLastAllocatedSerial: 50,
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect([r1.current, r2.current]).toEqual([50, 50]);

    const finalSeq = await prisma.documentSequence.findUniqueOrThrow({
      where: { documentType_financialYearId: { documentType: 'TAX_INVOICE', financialYearId: fy.id } },
    });
    expect(finalSeq.lastAllocatedSerial).toBe(50);
  });
});
