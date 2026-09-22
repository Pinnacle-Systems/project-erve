// Combined per-file entry point: opens exactly one pdfjs session for a
// source PDF and runs both the text parser and the image extractor against
// it (see pdf-document-session.ts's module comment for why a second
// session per file must be avoided). This is what the prepare CLI calls
// once per source document.
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { openPdfDocumentSession } from './pdf-document-session.js';
import { parsePurchaseOrderFromSession } from './po-pdf-parser.js';
import { unknownField, type ParsedPurchaseOrderRecord } from './po-pdf-parser.types.js';
import { extractStyleImageCandidate, type ExtractedImageCandidate } from './style-image-extractor.js';

export interface ProcessedHistoricalPurchaseOrder {
  parsed: ParsedPurchaseOrderRecord;
  image: ExtractedImageCandidate;
}

function failedParseRecord(meta: {
  sourceFileName: string;
  relativePath: string;
  checksum: string;
  sourceSizeBytes: number;
  sourceSeasonFolder: 'AW25' | 'SS26';
  reason: string;
}): ParsedPurchaseOrderRecord {
  return {
    sourceFileName: meta.sourceFileName,
    sourceRelativePath: meta.relativePath,
    sourceChecksumSha256: meta.checksum,
    sourceSizeBytes: meta.sourceSizeBytes,
    sourceSeasonFolder: meta.sourceSeasonFolder,
    warnings: [meta.reason],
    parseStatus: 'FAILED',
    legacyReferenceNumber: unknownField(),
    documentSeason: unknownField(),
    seasonFolderMismatch: false,
    factoryName: unknownField(),
    licenseStyleLmix: unknownField(),
    styleName: unknownField(),
    colour: unknownField(),
    description: unknownField(),
    hsnCode: unknownField(),
    orderDate: unknownField(),
    shipmentDate: unknownField(),
    unitRate: unknownField(),
    currency: unknownField(),
    paymentTerms: unknownField(),
    approvalSampleInstructions: unknownField(),
    aqlInspectionTerms: unknownField(),
    sizeQuantities: [],
    tableTotalQuantity: unknownField(),
    headerTotalQuantity: unknownField(),
    quantitySumMatchesTotal: null,
  };
}

const FAILED_IMAGE_CANDIDATE: ExtractedImageCandidate = {
  method: 'MANUAL_REVIEW',
  pageNumber: 1,
  imageBytes: null,
  widthPx: null,
  heightPx: null,
  sha256: null,
  notes: ['Source PDF could not be opened — see the parse record warnings'],
};

export async function processHistoricalPurchaseOrderPdf(options: {
  filePath: string;
  relativePath: string;
  sourceSeasonFolder: 'AW25' | 'SS26';
}): Promise<ProcessedHistoricalPurchaseOrder> {
  const fileBuffer = await readFile(options.filePath);
  const fileStat = await stat(options.filePath);
  const checksum = createHash('sha256').update(fileBuffer).digest('hex');
  const meta = {
    sourceFileName: basename(options.filePath),
    relativePath: options.relativePath,
    checksum,
    sourceSizeBytes: fileStat.size,
    sourceSeasonFolder: options.sourceSeasonFolder,
  };

  let session;
  try {
    session = await openPdfDocumentSession(new Uint8Array(fileBuffer));
  } catch (error) {
    return {
      parsed: failedParseRecord({
        ...meta,
        reason: `Unreadable/corrupt PDF: ${error instanceof Error ? error.message : String(error)}`,
      }),
      image: FAILED_IMAGE_CANDIDATE,
    };
  }

  try {
    const parsed = parsePurchaseOrderFromSession(session, {
      checksum,
      sourceFileName: meta.sourceFileName,
      relativePath: meta.relativePath,
      sourceSizeBytes: meta.sourceSizeBytes,
      sourceSeasonFolder: meta.sourceSeasonFolder,
    });
    const image = await extractStyleImageCandidate(session);
    return { parsed, image };
  } finally {
    await session.destroy();
  }
}
