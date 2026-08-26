import { createId } from '@erve/shared';
import { Prisma, DocumentType } from '../../db/prisma.js';
import { HttpError } from '../../errors/http-error.js';

type Tx = Prisma.TransactionClient;

/**
 * Append-only high-water-mark allocator. A `MAX(serial)` generator is unsafe
 * for Purchase Orders specifically because a DRAFT PO's Financial Year can
 * change (its poDate is editable pre-submission) — if a serial's document
 * moves to another FY, `MAX` over live rows would let the vacated serial be
 * reissued. This table/function is the one deliberate deviation from this
 * repo's usual "advisory lock + max+1 + composite unique" idiom
 * (ProcessFlowVersion.versionNumber, QualityFormVersion.versionNumber), and
 * only for that reason.
 *
 * Allocation happens inside the caller's transaction, so a rolled-back
 * document creation rolls back its serial increment too — a serial is
 * "consumed" only once that transaction commits.
 */
export async function allocateDocumentSerial(
  client: Tx,
  documentType: DocumentType,
  financialYearId: string,
): Promise<number> {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${documentType}::text || ':' || ${financialYearId}, 0))`;
  const sequence = await client.documentSequence.upsert({
    where: { documentType_financialYearId: { documentType, financialYearId } },
    create: { id: createId(), documentType, financialYearId, lastAllocatedSerial: 1 },
    update: { lastAllocatedSerial: { increment: 1 } },
  });
  return sequence.lastAllocatedSerial;
}

/**
 * Operational cutover helper — NOT allocation. Raises (never lowers) a
 * sequence's high-water mark to align with an already-issued external/manual
 * numbering series before this scheme's numbers are treated as durable
 * business identifiers. Called only from the `document-sequence-baseline`
 * CLI script, never from a public route. Uses the same lock as normal
 * allocation so it can't race a real document creation mid-adjustment.
 */
export async function setDocumentSequenceBaseline(
  client: Tx,
  documentType: DocumentType,
  financialYearCode: string,
  approvedLastAllocatedSerial: number,
): Promise<{ previous: number; current: number }> {
  const financialYear = await client.financialYear.findUnique({ where: { code: financialYearCode } });
  if (!financialYear) throw HttpError.notFound(`Financial Year ${financialYearCode} not found`);

  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${documentType}::text || ':' || ${financialYear.id}, 0))`;
  const existing = await client.documentSequence.findUnique({
    where: { documentType_financialYearId: { documentType, financialYearId: financialYear.id } },
  });
  const previous = existing?.lastAllocatedSerial ?? 0;

  if (approvedLastAllocatedSerial < previous) {
    throw HttpError.badRequest(
      `Refusing to lower ${documentType} sequence for FY ${financialYearCode} from ${previous} to ${approvedLastAllocatedSerial} — sequences are never decreased`,
    );
  }
  if (approvedLastAllocatedSerial === previous) {
    return { previous, current: previous };
  }

  await client.documentSequence.upsert({
    where: { documentType_financialYearId: { documentType, financialYearId: financialYear.id } },
    create: {
      id: createId(),
      documentType,
      financialYearId: financialYear.id,
      lastAllocatedSerial: approvedLastAllocatedSerial,
    },
    update: { lastAllocatedSerial: approvedLastAllocatedSerial },
  });
  return { previous, current: approvedLastAllocatedSerial };
}
