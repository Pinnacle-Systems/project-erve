import path from 'node:path';
import { lstat, realpath, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { z } from 'zod';

export const rebuildSafetySchema = z.object({
  disposableId: z.string().regex(/^[a-f0-9]{32}$/),
  databaseName: z.string().regex(/^erve_rebuild_[a-z0-9_]+_test$/),
  expectedServerAddress: z.string().min(1),
  sourceRoot: z.string().min(1),
  reportRoot: z.string().min(1),
  mediaRoot: z.string().min(1),
});
export type RebuildSafetyConfig = z.infer<typeof rebuildSafetySchema>;
export class RebuildSafetyError extends Error {}
export async function claimRebuildDirectory(root: string, owner: string) {
  await mkdir(root, { recursive: true });
  try {
    await writeFile(
      path.join(root, 'disposable-owner.json'),
      JSON.stringify({ owner, root: path.resolve(root) }),
      { flag: 'wx' },
    );
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    await assertNoDescendantLinks(root);
    const marker = JSON.parse(await readFile(path.join(root, 'disposable-owner.json'), 'utf8'));
    if (marker.owner !== owner || marker.root !== path.resolve(root))
      throw new RebuildSafetyError('Another target owns this output/media directory');
  }
}
async function assertNoDescendantLinks(root: string) {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const candidate = path.join(root, entry);
    const stat = await lstat(candidate);
    if (stat.isSymbolicLink())
      throw new RebuildSafetyError('Owned output/media contains a link or junction');
    if (stat.isDirectory()) await assertNoDescendantLinks(candidate);
  }
}
function within(child: string, parent: string) {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}
export function validateRebuildSafety(
  config: unknown,
  options: {
    databaseUrl: string;
    developmentDatabaseUrl?: string;
    nodeEnv: string;
    repositoryRoot: string;
    execute: boolean;
    confirmWrite: boolean;
  },
) {
  const value = rebuildSafetySchema.parse(config);
  if (options.nodeEnv === 'production')
    throw new RebuildSafetyError('Disposable rebuild refuses production execution');
  if (options.execute && !options.confirmWrite)
    throw new RebuildSafetyError('Execution requires --confirm-write');
  const url = new URL(options.databaseUrl);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.pathname !== `/${value.databaseName}`
  )
    throw new RebuildSafetyError(
      'Database URL does not match the explicit local disposable target',
    );
  if (options.developmentDatabaseUrl) {
    const development = new URL(options.developmentDatabaseUrl);
    if (
      (development.hostname === url.hostname ||
        ['localhost', '127.0.0.1', '[::1]'].includes(development.hostname)) &&
      (development.port || '5432') === (url.port || '5432') &&
      development.pathname === url.pathname
    )
      throw new RebuildSafetyError('Target must differ from the development database');
  }
  const roots = [value.sourceRoot, value.reportRoot, value.mediaRoot];
  if (roots.some((root) => !path.isAbsolute(root)))
    throw new RebuildSafetyError('Source, report and media roots must be absolute');
  const resolved = roots.map((root) => path.resolve(root));
  for (let index = 0; index < resolved.length; index++)
    for (let other = index + 1; other < resolved.length; other++)
      if (within(resolved[index]!, resolved[other]!) || within(resolved[other]!, resolved[index]!))
        throw new RebuildSafetyError('Source, report and media roots must be separate');
  for (const root of resolved)
    if (
      within(root, path.resolve(options.repositoryRoot)) ||
      within(path.resolve(options.repositoryRoot), root)
    )
      throw new RebuildSafetyError(
        'Generated reports/media must remain outside the application repository',
      );
  if (
    path.basename(value.reportRoot) !== `rebuild-${value.disposableId}` ||
    path.basename(value.mediaRoot) !== `media-${value.disposableId}`
  )
    throw new RebuildSafetyError('Report and media roots must identify this disposable owner');
  return value;
}
/** Reject junctions/symlinks before any mkdir or file write, including missing leaf directories. */
export async function assertRebuildPaths(config: RebuildSafetyConfig) {
  for (const root of [config.sourceRoot, config.reportRoot, config.mediaRoot]) {
    let current = path.resolve(root);
    while (true) {
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink())
          throw new RebuildSafetyError('Rebuild paths must not traverse links or junctions');
        if (path.resolve(await realpath(current)).toLowerCase() !== current.toLowerCase())
          throw new RebuildSafetyError('Rebuild path resolves outside its declared location');
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  await assertNoDescendantLinks(config.reportRoot);
  await assertNoDescendantLinks(config.mediaRoot);
}
