import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { openPdfDocumentSession } from './pdf-document-session.js';
import { extractDocumentarySections, requireDocumentarySections } from './documentary-sections.js';
import { sourceField } from './po-pdf-parser.types.js';
import type { SourceStagingRecord } from './staging.service.js';

/** Upgrade immutable H1 staging in memory from checksum-verified PDFs.
 * Only documentary fields change; identity overrides and all quantities,
 * dates, rates and image evidence remain untouched. The caller can persist
 * this as a NEW artifact, never overwrite the original approved staging.
 */
export async function reextractDocumentaryStaging(
  staging: SourceStagingRecord[], roots: { aw25Dir: string; ss26Dir: string }, options: { auditOnly?: boolean } = {},
): Promise<SourceStagingRecord[]> {
  const result: SourceStagingRecord[] = [];
  for (const record of staging) {
    const root = resolve(record.sourceSeasonFolder === 'AW25' ? roots.aw25Dir : roots.ss26Dir);
    const filePath = resolve(root, record.sourceRelativePath);
    const rel = relative(root, filePath);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Source PDF path escapes its declared root');
    const bytes = await readFile(filePath);
    if (bytes.length !== record.sourceSizeBytes || createHash('sha256').update(bytes).digest('hex') !== record.sourceChecksumSha256) {
      throw new Error(`Source PDF checksum mismatch: ${record.sourceFileName}`);
    }
    const session = await openPdfDocumentSession(new Uint8Array(bytes));
    try {
      const sections = extractDocumentarySections(session.layout, session.pageCount);
      if (!options.auditOnly) requireDocumentarySections(sections);
      result.push({ ...record, fields: { ...record.fields,
        description: sections.reviewReasons.length ? record.fields.description : sourceField(sections.styleDescription),
        styleName: sections.reviewReasons.length ? record.fields.styleName : sourceField(sections.tableStyleName),
        approvalSampleInstructions: sections.reviewReasons.length ? record.fields.approvalSampleInstructions : sourceField(sections.approvalText),
        documentarySections: sections,
      } });
    } finally { await session.destroy(); }
  }
  return result;
}
