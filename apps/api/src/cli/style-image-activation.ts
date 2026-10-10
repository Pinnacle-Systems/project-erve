// SM-001: generalized, reusable historical Style image activation —
// manifest-driven, idempotent, dry-run/execute. Generalizes the logic
// historical-job-order-commit.service.ts's `applyStyleImages` hardwires to
// one specific historical pipeline, so ANY approved image manifest —
// including a fresh run to REVALIDATE the existing 91-Style AW25/SS26 batch
// against current artifacts — goes through the same safe, reviewed path,
// rather than treating that one-off historical import as a substitute for
// this deliverable.
//
// Reuses the existing `reconcileImage` disposition logic (exact-hash dedup,
// never auto-replacing a conflicting image) and `uploadStyleImage` (checksum
// dedup, transactional primary-image assignment) — no parallel image logic.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../db/prisma.js';
import type { CurrentUser } from '../auth/current-user.js';
import { reconcileImage } from '../modules/historical-import/reconciliation.service.js';
import { uploadStyleImage } from '../modules/master-data/style-images.service.js';

export interface ImageActivationManifestEntry {
  styleNumber: string;
  /** Relative to the --images-dir supplied to the CLI, never an absolute/caller-supplied path used directly. */
  imageRelativePath: string;
  /** The approved sha256 for this exact image — a mismatch against the file on disk is refused, never guessed past. */
  sha256: string;
}

export interface ImageActivationManifest {
  records: ImageActivationManifestEntry[];
}

export type ImageActivationAction =
  | 'UPLOAD'
  | 'SKIP_ALREADY_PRESENT'
  | 'REVIEW_CONFLICT'
  | 'STYLE_NOT_FOUND'
  | 'AMBIGUOUS_STYLE'
  | 'FILE_MISSING'
  | 'CHECKSUM_MISMATCH';

export interface ImageActivationPlanRow {
  styleNumber: string;
  imageRelativePath: string;
  expectedSha256: string;
  styleId: string | null;
  action: ImageActivationAction;
  note: string;
}

export async function planImageActivation(
  manifest: ImageActivationManifest,
  imagesDir: string,
): Promise<ImageActivationPlanRow[]> {
  const rows: ImageActivationPlanRow[] = [];

  for (const entry of manifest.records) {
    const base = { styleNumber: entry.styleNumber, imageRelativePath: entry.imageRelativePath, expectedSha256: entry.sha256 };

    const styles = await prisma.style.findMany({ where: { styleNumber: entry.styleNumber }, select: { id: true } });
    if (styles.length === 0) {
      rows.push({ ...base, styleId: null, action: 'STYLE_NOT_FOUND', note: `No Style with Style Number "${entry.styleNumber}"` });
      continue;
    }
    if (styles.length > 1) {
      rows.push({ ...base, styleId: null, action: 'AMBIGUOUS_STYLE', note: `${styles.length} Styles match "${entry.styleNumber}"` });
      continue;
    }
    const styleId = styles[0]!.id;

    let fileBytes: Buffer;
    try {
      fileBytes = await readFile(path.join(imagesDir, entry.imageRelativePath));
    } catch {
      rows.push({ ...base, styleId, action: 'FILE_MISSING', note: `Missing file: ${entry.imageRelativePath}` });
      continue;
    }

    const actualSha256 = createHash('sha256').update(fileBytes).digest('hex');
    if (actualSha256 !== entry.sha256) {
      rows.push({
        ...base,
        styleId,
        action: 'CHECKSUM_MISMATCH',
        note: `File hash ${actualSha256.slice(0, 12)}... does not match the manifest's approved hash — refusing`,
      });
      continue;
    }

    const disposition = await reconcileImage(
      prisma,
      { method: 'EMBEDDED_IMAGE', pageNumber: 1, imageBytes: null, widthPx: null, heightPx: null, sha256: entry.sha256, notes: [] },
      styleId,
    );
    const action: ImageActivationAction =
      disposition.disposition === 'UPLOAD'
        ? 'UPLOAD'
        : disposition.disposition === 'SKIP_ALREADY_PRESENT'
          ? 'SKIP_ALREADY_PRESENT'
          : 'REVIEW_CONFLICT';
    rows.push({ ...base, styleId, action, note: disposition.note });
  }

  return rows;
}

export interface ImageActivationResult {
  styleNumber: string;
  imageRelativePath: string;
  outcome: 'UPLOADED' | 'SKIPPED_ALREADY_PRESENT' | 'SKIPPED_NOT_UPLOADABLE';
  note: string;
}

export async function executeImageActivation(
  actor: CurrentUser,
  rows: ImageActivationPlanRow[],
  imagesDir: string,
): Promise<ImageActivationResult[]> {
  const results: ImageActivationResult[] = [];

  for (const row of rows) {
    if (row.action !== 'UPLOAD') {
      results.push({
        styleNumber: row.styleNumber,
        imageRelativePath: row.imageRelativePath,
        outcome: row.action === 'SKIP_ALREADY_PRESENT' ? 'SKIPPED_ALREADY_PRESENT' : 'SKIPPED_NOT_UPLOADABLE',
        note: row.note,
      });
      continue;
    }

    // Re-verify at execute time, not just at plan time — defense in depth
    // against the file changing on disk between planning and executing.
    const fileBytes = await readFile(path.join(imagesDir, row.imageRelativePath));
    const actualSha256 = createHash('sha256').update(fileBytes).digest('hex');
    if (actualSha256 !== row.expectedSha256) {
      results.push({
        styleNumber: row.styleNumber,
        imageRelativePath: row.imageRelativePath,
        outcome: 'SKIPPED_NOT_UPLOADABLE',
        note: 'File changed since planning — refusing to upload an unverified image',
      });
      continue;
    }

    const outcome = await uploadStyleImage(actor, row.styleId!, {
      buffer: fileBytes,
      originalName: path.basename(row.imageRelativePath),
    });
    results.push({
      styleNumber: row.styleNumber,
      imageRelativePath: row.imageRelativePath,
      outcome: outcome.created ? 'UPLOADED' : 'SKIPPED_ALREADY_PRESENT',
      note: outcome.created
        ? `Uploaded (isPrimary=${outcome.image.isPrimary})`
        : 'Identical image already present — idempotent re-run, nothing duplicated',
    });
  }

  return results;
}

export function summarizeImageActivationPlan(rows: ImageActivationPlanRow[]) {
  const count = (action: ImageActivationAction) => rows.filter((row) => row.action === action).length;
  return {
    totalRows: rows.length,
    upload: count('UPLOAD'),
    skipAlreadyPresent: count('SKIP_ALREADY_PRESENT'),
    reviewConflict: count('REVIEW_CONFLICT'),
    styleNotFound: count('STYLE_NOT_FOUND'),
    ambiguousStyle: count('AMBIGUOUS_STYLE'),
    fileMissing: count('FILE_MISSING'),
    checksumMismatch: count('CHECKSUM_MISMATCH'),
  };
}
