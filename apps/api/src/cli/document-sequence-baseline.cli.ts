#!/usr/bin/env node
// Operational cutover helper for Financial-Year-aware document numbering.
// Raises (never lowers) a Purchase Order / Job Order sequence's high-water
// mark to align with an already-issued external/manual numbering series
// before this scheme's numbers are treated as durable business identifiers.
// Not a public HTTP endpoint — deliberately a script, run once per cutover.
//
// Usage (from apps/api):
//   tsx src/cli/document-sequence-baseline.cli.ts \
//     --document-type PURCHASE_ORDER --financial-year 2026-27 --serial 68
import { prisma } from '../db/prisma.js';
import type { DocumentType } from '../db/prisma.js';
import { runDocumentSequenceBaseline, DocumentSequenceBaselineError } from './document-sequence-baseline.js';

const DOCUMENT_TYPES: DocumentType[] = ['PURCHASE_ORDER', 'JOB_ORDER'];

function parseArgs(argv: string[]): {
  documentType: DocumentType;
  financialYearCode: string;
  approvedLastAllocatedSerial: number;
} {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const documentTypeRaw = get('--document-type');
  const financialYearCode = get('--financial-year');
  const serialRaw = get('--serial');

  if (!documentTypeRaw || !DOCUMENT_TYPES.includes(documentTypeRaw as DocumentType)) {
    throw new DocumentSequenceBaselineError(
      `--document-type is required and must be one of: ${DOCUMENT_TYPES.join(', ')}`,
    );
  }
  if (!financialYearCode) {
    throw new DocumentSequenceBaselineError('--financial-year is required, e.g. 2026-27');
  }
  const approvedLastAllocatedSerial = Number(serialRaw);
  if (!serialRaw || !Number.isInteger(approvedLastAllocatedSerial) || approvedLastAllocatedSerial < 0) {
    throw new DocumentSequenceBaselineError('--serial is required and must be a non-negative integer');
  }

  return { documentType: documentTypeRaw as DocumentType, financialYearCode, approvedLastAllocatedSerial };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await runDocumentSequenceBaseline(options);

  if (!result.changed) {
    console.log(
      `no-op: ${result.documentType} sequence for FY ${result.financialYearCode} is already at ${result.current}`,
    );
    return;
  }
  console.log(
    `raised: ${result.documentType} sequence for FY ${result.financialYearCode} from ${result.previous} to ${result.current}`,
  );
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error: unknown) => {
    if (error instanceof DocumentSequenceBaselineError) {
      console.error(error.message);
    } else {
      console.error('Unexpected error while adjusting the document sequence baseline:');
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
