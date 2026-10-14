import { realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
async function resolveThroughParents(value) {
  let current = resolve(value);
  const suffix = [];
  while (true) {
    try {
      return resolve(await realpath(current), ...suffix);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      suffix.unshift(basename(current));
      current = parent;
    }
  }
}
const within = (child, parent) => {
  const rel = relative(parent, child);
  return !rel || (!rel.startsWith('..') && !isAbsolute(rel));
};
export async function assertExternalArtifactRoot(output, protectedRoots) {
  const actual = await resolveThroughParents(output);
  for (const root of protectedRoots) {
    const repository = await realpath(root);
    if (within(actual, repository) || within(repository, actual))
      throw Error('PR8 artifacts and credentials must remain outside all repository roots');
  }
  return actual;
}
export function repositoryRoots(repository) {
  const common = execFileSync(
    'git',
    ['-C', repository, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    { encoding: 'utf8', windowsHide: true },
  ).trim();
  return [repository, dirname(common)];
}
