import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { buildSyntheticPdf } from './__fixtures__/synthetic-pdf.js';
import { reextractDocumentaryStaging } from './documentary-staging.js';
import { parsePurchaseOrderBuffer } from './po-pdf-parser.js';
import type { SourceStagingRecord } from './staging.service.js';

it('preserves ambiguous source evidence for audit, but refuses to stage it for import', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'h2b1-source-'));
  try {
    const bytes = buildSyntheticPdf([{ text: 'Different PDF wording and an ambiguous boundary', x: 20, y: 250 }]);
    const file = join(dir, 'source.pdf');
    await writeFile(file, bytes);
    const parsed = await parsePurchaseOrderBuffer({ fileBuffer: bytes, sourceFileName: 'source.pdf', relativePath: 'source.pdf', sourceSizeBytes: bytes.length, sourceSeasonFolder: 'AW25' });
    const { sourceFileName, sourceRelativePath, sourceChecksumSha256, sourceSizeBytes, sourceSeasonFolder, parseStatus, warnings, ...fields } = parsed;
    const staging: SourceStagingRecord = { sourceFileName, sourceRelativePath, sourceChecksumSha256, sourceSizeBytes, sourceSeasonFolder, parseStatus, warnings, fields,
      imageExtractionMethod: 'MANUAL_REVIEW', imageSha256: null, imageWidthPx: null, imageHeightPx: null, imageRelativePath: null, imageNotes: [] };
    const original = JSON.stringify(staging);
    const roots = { aw25Dir: dir, ss26Dir: dir };
    await expect(reextractDocumentaryStaging([staging], roots)).rejects.toThrow('REVIEW_REQUIRED');
    const audited = await reextractDocumentaryStaging([staging], roots, { auditOnly: true });
    expect(audited[0]!.fields.documentarySections!.reviewReasons.length).toBeGreaterThan(0);
    expect(audited[0]!.fields.documentarySections!.layoutEvidence!.lines[0]!.text).toBe('Different PDF wording and an ambiguous boundary');
    expect(JSON.stringify(staging)).toBe(original);
    expect(createHash('sha256').update(await readFile(file)).digest('hex')).toBe(sourceChecksumSha256);
    await expect(reextractDocumentaryStaging([{ ...staging, sourceChecksumSha256: '0'.repeat(64) }], roots)).rejects.toThrow('checksum mismatch');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
