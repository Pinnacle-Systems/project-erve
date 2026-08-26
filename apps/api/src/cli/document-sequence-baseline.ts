import { prisma } from '../db/prisma.js';
import type { DocumentType } from '../db/prisma.js';
import { setDocumentSequenceBaseline } from '../modules/master-data/document-sequence.service.js';

export class DocumentSequenceBaselineError extends Error {}

export interface DocumentSequenceBaselineOptions {
  documentType: DocumentType;
  financialYearCode: string;
  approvedLastAllocatedSerial: number;
}

export interface DocumentSequenceBaselineResult {
  documentType: DocumentType;
  financialYearCode: string;
  previous: number;
  current: number;
  changed: boolean;
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
): Promise<DocumentSequenceBaselineResult> {
  const { previous, current } = await prisma.$transaction((tx) =>
    setDocumentSequenceBaseline(
      tx,
      options.documentType,
      options.financialYearCode,
      options.approvedLastAllocatedSerial,
    ),
  );
  return {
    documentType: options.documentType,
    financialYearCode: options.financialYearCode,
    previous,
    current,
    changed: current !== previous,
  };
}
