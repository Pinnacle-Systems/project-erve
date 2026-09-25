// H3A image-output identity hardening: images are named by an effective
// identity, never silently overwritten on a hash collision, and the
// printed reference is kept as provenance only. Synthetic records only.
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PrepareOutputError, writePrepareOutputs, type ImageOutputIdentityResolver } from './staging.service.js';
import type { ParsedPurchaseOrderRecord } from './po-pdf-parser.types.js';
import type { ExtractedImageCandidate } from './style-image-extractor.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function freshDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'h3a-staging-'));
  dirs.push(dir);
  return dir;
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function parsed(sourceFileName: string, printedRef: string, sourceChecksumSha256: string): ParsedPurchaseOrderRecord {
  return {
    sourceFileName,
    sourceRelativePath: sourceFileName,
    sourceChecksumSha256,
    sourceSizeBytes: 100,
    sourceSeasonFolder: 'SS26',
    parseStatus: 'OK',
    warnings: [],
    legacyReferenceNumber: { value: printedRef, provenance: 'SOURCE' },
  } as unknown as ParsedPurchaseOrderRecord;
}

function image(bytes: Buffer): ExtractedImageCandidate {
  return { method: 'EMBEDDED_IMAGE', pageNumber: 1, imageBytes: bytes, widthPx: 1, heightPx: 1, sha256: sha(bytes), notes: [] };
}

// Mirrors the real defect: EI26032.pdf prints "EI26031".
const a = parsed('EI26031.pdf', 'EI26031', 'a'.repeat(64));
const b = parsed('EI26032.pdf', 'EI26031', 'b'.repeat(64));
const bytesA = Buffer.from('image-A');
const bytesB = Buffer.from('image-B');
const effective: ImageOutputIdentityResolver = (p) =>
  p.sourceChecksumSha256 === b.sourceChecksumSha256 ? { identity: 'EI26032', source: 'EFFECTIVE_OVERRIDE' } : { identity: p.legacyReferenceNumber.value!, source: 'PRINTED_REFERENCE' };

describe('writePrepareOutputs image identity', () => {
  it('names images by effective identity, keeping both distinct images and the printed reference as provenance', async () => {
    const dir = await freshDir();
    const out = await writePrepareOutputs(dir, [{ parsed: a, image: image(bytesA) }, { parsed: b, image: image(bytesB) }], {
      parserVersion: 'test',
      resolveImageIdentity: effective,
    });
    expect(out.imageOutcomes).toMatchObject({ WRITTEN: 2, COLLISION_REVIEW_REQUIRED: 0 });
    expect(sha(await readFile(join(dir, 'images', 'SS26', 'EI26031.png')))).toBe(sha(bytesA));
    expect(sha(await readFile(join(dir, 'images', 'SS26', 'EI26032.png')))).toBe(sha(bytesB));
    const staging = JSON.parse(await readFile(out.sourceStagingPath, 'utf8'));
    expect(staging[1]).toMatchObject({ imagePrintedLegacyReference: 'EI26031', imageOutputIdentity: 'EI26032', imageOutputIdentitySource: 'EFFECTIVE_OVERRIDE' });
  });

  it('treats the same identity with a different hash as a HARD COLLISION and never overwrites', async () => {
    const dir = await freshDir();
    const out = await writePrepareOutputs(dir, [{ parsed: a, image: image(bytesA) }, { parsed: b, image: image(bytesB) }], { parserVersion: 'test' });
    expect(out.imageOutcomes).toMatchObject({ WRITTEN: 1, COLLISION_REVIEW_REQUIRED: 1 });
    expect(sha(await readFile(join(dir, 'images', 'SS26', 'EI26031.png')))).toBe(sha(bytesA));
    expect(out.imageCollisions).toHaveLength(1);
    expect(out.imageCollisions[0]!.collision).toMatchObject({ existingSha256: sha(bytesA), candidateSha256: sha(bytesB), existingFrom: 'THIS_RUN' });
    const staging = JSON.parse(await readFile(out.sourceStagingPath, 'utf8'));
    expect(staging[1]).toMatchObject({ imageOutcome: 'COLLISION_REVIEW_REQUIRED', imageRelativePath: null });
  });

  it('treats the same identity with the same hash as an idempotent no-op', async () => {
    const dir = await freshDir();
    const twin = parsed('EI26031-copy.pdf', 'EI26031', 'c'.repeat(64));
    const out = await writePrepareOutputs(dir, [{ parsed: a, image: image(bytesA) }, { parsed: twin, image: image(bytesA) }], { parserVersion: 'test' });
    expect(out.imageOutcomes).toMatchObject({ WRITTEN: 1, IDENTICAL_NO_OP: 1, COLLISION_REVIEW_REQUIRED: 0 });
  });

  it('refuses to regenerate over an existing immutable source-staging.json', async () => {
    const dir = await freshDir();
    await writePrepareOutputs(dir, [{ parsed: a, image: image(bytesA) }], { parserVersion: 'test' });
    await expect(writePrepareOutputs(dir, [{ parsed: a, image: image(bytesB) }], { parserVersion: 'test' })).rejects.toBeInstanceOf(PrepareOutputError);
    expect(sha(await readFile(join(dir, 'images', 'SS26', 'EI26031.png')))).toBe(sha(bytesA));
  });
});
