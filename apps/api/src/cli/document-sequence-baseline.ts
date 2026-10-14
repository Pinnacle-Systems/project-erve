import { prisma } from '../db/prisma.js';
import type { Prisma, DocumentType } from '../db/prisma.js';
import { setDocumentSequenceBaseline } from '../modules/master-data/document-sequence.service.js';

export class DocumentSequenceBaselineError extends Error {}

class DryRunRollbackSignal {
  constructor(public readonly result: { previous: number; current: number; created: boolean }) {}
}

export interface DocumentSequenceBaselineOptions {
  documentType: DocumentType;
  financialYearCode: string;
  approvedLastAllocatedSerial: number;
  dryRun?: boolean;
}

export interface DocumentSequenceBaselineResult {
  documentType: DocumentType;
  financialYearCode: string;
  previous: number;
  current: number;
  changed: boolean;
  created: boolean;
}

/**
 * Operational cutover helper — NOT part of normal numbering. Raises (never
 * lowers) a DocumentSequence's high-water mark so it aligns with an
 * already-issued external/manual numbering series before this scheme's
 * numbers are treated as durable business identifiers. See
 * document-sequence.service.ts's setDocumentSequenceBaseline for the
 * never-decrease invariant and advisory-lock behavior this wraps in a
 * transaction.
 */
export async function runDocumentSequenceBaseline(
  options: DocumentSequenceBaselineOptions,
  deps?: { prisma?: { $transaction: Prisma.TransactionClient['$transaction'] } },
): Promise<DocumentSequenceBaselineResult> {
  const client = (deps?.prisma ?? prisma) as typeof prisma;

  let outcome: { previous: number; current: number; created: boolean };

  if (options.dryRun) {
    try {
      await client.$transaction(async (tx) => {
        const result = await setDocumentSequenceBaseline(
          tx,
          options.documentType,
          options.financialYearCode,
          options.approvedLastAllocatedSerial,
        );
        throw new DryRunRollbackSignal(result);
      });
      throw new Error('Unreachable: dry-run did not roll back');
    } catch (err: unknown) {
      if (err instanceof DryRunRollbackSignal) {
        outcome = err.result;
      } else {
        throw err;
      }
    }
  } else {
    outcome = await client.$transaction((tx) =>
      setDocumentSequenceBaseline(
        tx,
        options.documentType,
        options.financialYearCode,
        options.approvedLastAllocatedSerial,
      ),
    );
  }

  const { previous, current, created } = outcome;
  return {
    documentType: options.documentType,
    financialYearCode: options.financialYearCode,
    previous,
    current,
    changed: created || current !== previous,
    created,
  };
}

