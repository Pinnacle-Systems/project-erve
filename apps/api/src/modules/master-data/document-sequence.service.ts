import { createId } from '@erve/shared';
import { Prisma, DocumentType } from '../../db/prisma.js';
import { HttpError } from '../../errors/http-error.js';
import {
  DOCUMENT_PREFIXES,
  CANONICAL_EI_INVOICE_REGEX,
  formatDocumentNumber,
} from './document-number.util.js';
import { toCompactFinancialYearCode } from './financial-year.util.js';

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
 * Inspects existing database records for the given documentType and financial year
 * to find the highest allocated serial currently in durable storage.
 */
export async function getHighestAllocatedDocumentSerial(
  client: Tx,
  documentType: DocumentType,
  financialYearId: string,
  financialYearCode: string,
): Promise<{ maxSerial: number; highestIdentifier?: string }> {
  if (documentType === 'TAX_INVOICE') {
    const compactCode = toCompactFinancialYearCode(financialYearCode);
    const invoices = await client.$queryRaw<Array<{ invoice_number: string | null }>>`
      SELECT invoice_number
      FROM tax_invoices
      WHERE invoice_number IS NOT NULL
        AND (financial_year_id = ${financialYearId} OR invoice_number LIKE ${`%/${compactCode}/%`})
    `;
    let max = 0;
    let highestIdentifier: string | undefined;
    for (const inv of invoices) {
      if (!inv.invoice_number) continue;
      const match = CANONICAL_EI_INVOICE_REGEX.exec(inv.invoice_number);
      if (match && match[2]) {
        const serial = Number.parseInt(match[2], 10);
        if (!Number.isNaN(serial) && serial > max) {
          max = serial;
          highestIdentifier = inv.invoice_number;
        }
      }
    }
    return { maxSerial: max, highestIdentifier };
  }

  if (documentType === 'PURCHASE_ORDER') {
    const [row] = await client.$queryRaw<Array<{ max_serial: number | null }>>`
      SELECT MAX(po_serial) AS max_serial
      FROM distributor_purchase_orders
      WHERE financial_year_id = ${financialYearId}
    `;
    const max = row?.max_serial ?? 0;
    return {
      maxSerial: max,
      highestIdentifier:
        max > 0 ? formatDocumentNumber(DOCUMENT_PREFIXES.PURCHASE_ORDER, financialYearCode, max) : undefined,
    };
  }

  if (documentType === 'JOB_ORDER') {
    const [row] = await client.$queryRaw<Array<{ max_serial: number | null }>>`
      SELECT MAX(job_order_serial) AS max_serial
      FROM job_orders
      WHERE financial_year_id = ${financialYearId}
    `;
    const max = row?.max_serial ?? 0;
    return {
      maxSerial: max,
      highestIdentifier:
        max > 0 ? formatDocumentNumber(DOCUMENT_PREFIXES.JOB_ORDER, financialYearCode, max) : undefined,
    };
  }

  return { maxSerial: 0 };
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
): Promise<{ previous: number; current: number; created: boolean }> {
  const financialYear = await client.financialYear.findUnique({ where: { code: financialYearCode } });
  if (!financialYear) throw HttpError.notFound(`Financial Year ${financialYearCode} not found`);

  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${documentType}::text || ':' || ${financialYear.id}, 0))`;

  // Safeguard: refuse to set baseline behind existing records of this document type
  const { maxSerial: maxExistingSerial, highestIdentifier } = await getHighestAllocatedDocumentSerial(
    client,
    documentType,
    financialYear.id,
    financialYearCode,
  );
  if (approvedLastAllocatedSerial < maxExistingSerial) {
    const identNote = highestIdentifier ? ` (highest: ${highestIdentifier})` : '';
    throw HttpError.badRequest(
      `Refusing to set ${documentType} sequence for FY ${financialYearCode} to ${approvedLastAllocatedSerial}: ` +
        `existing ${documentType} records in this financial year have reached serial ${maxExistingSerial}${identNote} ` +
        `— baseline cannot be set behind existing records`,
    );
  }

  const existing = await client.documentSequence.findUnique({
    where: { documentType_financialYearId: { documentType, financialYearId: financialYear.id } },
  });

  if (!existing) {
    // Missing-row initialization: creates the sequence row explicitly with the approved serial,
    // including baseline 0 for a fresh sequence (so next allocation is 1).
    await client.documentSequence.create({
      data: {
        id: createId(),
        documentType,
        financialYearId: financialYear.id,
        lastAllocatedSerial: approvedLastAllocatedSerial,
      },
    });
    return { previous: 0, current: approvedLastAllocatedSerial, created: true };
  }

  const previous = existing.lastAllocatedSerial;

  if (approvedLastAllocatedSerial < previous) {
    throw HttpError.badRequest(
      `Refusing to lower ${documentType} sequence for FY ${financialYearCode} from ${previous} to ${approvedLastAllocatedSerial} — sequences are never decreased`,
    );
  }

  if (approvedLastAllocatedSerial === previous) {
    return { previous, current: previous, created: false };
  }

  await client.documentSequence.update({
    where: { documentType_financialYearId: { documentType, financialYearId: financialYear.id } },
    data: { lastAllocatedSerial: approvedLastAllocatedSerial },
  });

  return { previous, current: approvedLastAllocatedSerial, created: false };
}

