// Immutable source manifest (H1 plan §20). Built once by the prepare step
// from the real archive; H2 and H3 recompute and verify every source file
// against this approved manifest before acting, rather than trusting the
// files haven't changed.
import { createHash } from 'node:crypto';

export interface SourceManifestFileEntry {
  season: 'AW25' | 'SS26';
  relativeFilename: string;
  sizeBytes: number;
  sha256: string;
}

export interface SourceManifest {
  manifestVersion: 1;
  parserVersion: string;
  generatedAt: string;
  parserGitCommitSha: string | null;
  aw25Count: number;
  ss26Count: number;
  totalCount: number;
  files: SourceManifestFileEntry[];
  /** sha256 over the deterministically-sorted canonical `season|filename|size|sha256` tuples — hashing the identity tuple, not just content, so a same-content file renamed/moved between season folders can't produce a matching aggregate. */
  aggregateSha256: string;
}

function canonicalTuple(entry: SourceManifestFileEntry): string {
  return `${entry.season}|${entry.relativeFilename}|${entry.sizeBytes}|${entry.sha256}`;
}

export function buildSourceManifest(
  files: SourceManifestFileEntry[],
  options: { parserVersion: string; generatedAt?: Date; parserGitCommitSha?: string | null },
): SourceManifest {
  const sorted = [...files].sort((a, b) => canonicalTuple(a).localeCompare(canonicalTuple(b)));
  const aggregateSha256 = createHash('sha256').update(sorted.map(canonicalTuple).join('\n')).digest('hex');

  return {
    manifestVersion: 1,
    parserVersion: options.parserVersion,
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    parserGitCommitSha: options.parserGitCommitSha ?? null,
    aw25Count: files.filter((f) => f.season === 'AW25').length,
    ss26Count: files.filter((f) => f.season === 'SS26').length,
    totalCount: files.length,
    files: sorted,
    aggregateSha256,
  };
}
