import { RebuildSafetyError } from './disposable-rebuild-safety.js';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';

export const inputNames = [
  'seasons',
  'sizes',
  'factories',
  'distributors',
  'retailStores',
  'styles',
] as const;
export type RebuildInputName = (typeof inputNames)[number];
export const sealedInputsSchema = z.object({
  sourceRoot: z.string().min(1),
  manifestFile: z.string().min(1),
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  files: z.object({
    seasons: z.string(),
    sizes: z.string(),
    factories: z.string(),
    distributors: z.string(),
    retailStores: z.string(),
    styles: z.string(),
  }),
});
export const rebuildChecksum = (value: Buffer | string) =>
  createHash('sha256').update(value).digest('hex');
async function sourcePath(root: string, relative: string) {
  if (path.isAbsolute(relative))
    throw new RebuildSafetyError('Input path is outside the sealed source root');
  const candidate = path.resolve(root, relative);
  const local = path.relative(path.resolve(root), candidate);
  if (!local || local.startsWith('..') || path.isAbsolute(local))
    throw new RebuildSafetyError('Input path is outside the sealed source root');
  if (
    (await lstat(candidate)).isSymbolicLink() ||
    path.resolve(await realpath(candidate)).toLowerCase() !== candidate.toLowerCase()
  )
    throw new RebuildSafetyError('Input paths must not traverse links');
  return candidate;
}
export async function loadRebuildInputs(config: unknown) {
  const value = sealedInputsSchema.parse(config);
  // Check every declared path before checksums, so unsafe paths fail without a read.
  const paths = Object.fromEntries(
    await Promise.all(
      inputNames.map(async (name) => [name, await sourcePath(value.sourceRoot, value.files[name])]),
    ),
  );
  const manifestBytes = await readFile(await sourcePath(value.sourceRoot, value.manifestFile));
  if (rebuildChecksum(manifestBytes) !== value.manifestSha256)
    throw new RebuildSafetyError('Manifest checksum changed; seal and review inputs again');
  const manifest = z
    .object({
      outputs: z.array(z.object({ file: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })),
    })
    .passthrough()
    .parse(JSON.parse(manifestBytes.toString('utf8')));
  if (new Set(manifest.outputs.map((output) => output.file)).size !== manifest.outputs.length)
    throw new RebuildSafetyError('Manifest has duplicate output paths');
  const loaded = await Promise.all(
    inputNames.map(async (name) => {
      const expected = manifest.outputs.find((output) => output.file === value.files[name]);
      if (!expected) throw new RebuildSafetyError(`Manifest does not declare ${name}`);
      const buffer = await readFile(paths[name]!);
      if (rebuildChecksum(buffer) !== expected.sha256)
        throw new RebuildSafetyError(
          `Input checksum changed for ${name}; preview corrected inputs again`,
        );
      return [
        name,
        { buffer, fileName: path.basename(paths[name]!), sha256: expected.sha256 },
      ] as const;
    }),
  );
  return {
    manifest,
    manifestSha256: value.manifestSha256,
    files: Object.fromEntries(loaded) as Record<
      RebuildInputName,
      { buffer: Buffer; fileName: string; sha256: string }
    >,
  };
}
