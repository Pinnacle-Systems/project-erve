// H2B.2 Stage A HSN correction: re-derives Style.hsnCode straight from the
// source PDFs using the CURRENT extractHsnCode implementation (po-pdf-
// parser.ts). Reuses the exact same per-file entry point historical-import-
// prepare.ts uses for a fresh import — never a second parsing implementation
// — so a Dev backfill and a clean future Production import always agree.
// Structurally read-only: no database access, no write-service reference.
//
// Keyed by sourceChecksumSha256, NOT by the PDF's own printed
// legacyReferenceNumber: EI26032.pdf's raw printed order number is the
// typo'd "EI26031" (a genuine, H2A-investigated, APPROVED-override source
// defect — see .artifacts/historical-import/AW25-SS26/h2a/
// ei26031-ei26032-investigation.md). Keying by the raw printed value would
// silently collide two distinct documents onto one map entry — confirmed by
// running this exact bug once: it wrote EI26032's HSN code onto EI26031's
// Style. The effective (override-corrected) legacyReferenceNumber is only
// known one layer up, in buildEffectiveSourceRecords — so the caller resolves
// this map via effectiveRecord.sourceChecksumSha256, which is unique by
// construction regardless of any printed-text ambiguity.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { processHistoricalPurchaseOrderPdf } from './historical-po-pdf-processor.js';
import type { ParseStatus } from './po-pdf-parser.types.js';

export interface HsnRefreshEntry {
  sourceChecksumSha256: string;
  legacyReferenceNumber: string | null;
  sourceSeasonFolder: 'AW25' | 'SS26';
  sourceFileName: string;
  hsnCode: string | null;
  parseStatus: ParseStatus;
}

export async function refreshHsnCodesFromSourcePdfs(options: {
  aw25Dir: string;
  ss26Dir: string;
}): Promise<HsnRefreshEntry[]> {
  const seasonFolders: Array<{ season: 'AW25' | 'SS26'; dir: string }> = [
    { season: 'AW25', dir: options.aw25Dir },
    { season: 'SS26', dir: options.ss26Dir },
  ];
  const entries: HsnRefreshEntry[] = [];
  for (const { season, dir } of seasonFolders) {
    const files = (await readdir(dir)).filter((name) => name.toLowerCase().endsWith('.pdf')).sort();
    for (const fileName of files) {
      const { parsed } = await processHistoricalPurchaseOrderPdf({
        filePath: join(dir, fileName),
        relativePath: fileName,
        sourceSeasonFolder: season,
      });
      entries.push({
        sourceChecksumSha256: parsed.sourceChecksumSha256,
        legacyReferenceNumber: parsed.legacyReferenceNumber.value,
        sourceSeasonFolder: season,
        sourceFileName: fileName,
        hsnCode: parsed.hsnCode.value,
        parseStatus: parsed.parseStatus,
      });
    }
  }
  return entries;
}

export function indexHsnRefreshBySourceChecksum(entries: HsnRefreshEntry[]): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const entry of entries) {
    if (map.has(entry.sourceChecksumSha256)) {
      throw new Error(`Duplicate source PDF checksum ${entry.sourceChecksumSha256} (${entry.sourceFileName}) — refusing to silently pick one`);
    }
    map.set(entry.sourceChecksumSha256, entry.hsnCode);
  }
  return map;
}
