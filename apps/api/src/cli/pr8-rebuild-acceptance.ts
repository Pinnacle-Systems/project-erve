import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { prisma } from '../db/prisma.js';
import { executeDisposableRebuild, planDisposableRebuild } from './disposable-rebuild.js';

async function main() {
  if (!process.env.PR8_CONFIG || !process.env.PR8_RUN_ROOT)
    throw new Error('Explicit PR8 config/run root required');
  const config = JSON.parse(await readFile(process.env.PR8_CONFIG, 'utf8'));
  const options = {
    execute: true,
    confirmWrite: true,
    repositoryRoot: path.resolve(import.meta.dirname, '../../../..'),
  };
  const planning = await planDisposableRebuild(config, {
    ...options,
    execute: false,
    confirmWrite: false,
  });
  const require = createRequire(import.meta.url);
  if (path.resolve(process.env.PR8_RUN_ROOT) !== path.dirname(path.resolve(config.reportRoot)))
    throw new Error('PR8 run root must be the verified external report parent');
  const migrate = () =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
        { cwd: path.resolve(import.meta.dirname, '../..'), windowsHide: true, stdio: 'ignore' },
      );
      child.on('error', reject);
      child.on('exit', (code) =>
        code === 0 ? resolve() : reject(new Error('Committed migrations failed')),
      );
    });
  const password = () => readFile(process.env.ADMIN_PASSWORD_FILE!, 'utf8');
  const profile = path.basename(process.env.PR8_CONFIG).replace('-config.json', '');
  const attempts: unknown[] = [];
  if (profile === 'interruption') {
    for (const boundary of ['factories', 'styles']) {
      let injected = false;
      try {
        await executeDisposableRebuild(config, options, {
          migrate,
          getAdminPassword: password,
          afterStage: async (stage) => {
            if (stage === boundary) {
              injected = true;
              throw new Error(`Controlled PR8 interruption after ${boundary}`);
            }
          },
        });
      } catch (error) {
        if (!injected) throw error;
      }
      if (!injected) throw new Error('Expected injection boundary was not reached');
      attempts.push({ boundary, faultInjected: true });
    }
  }
  const first = await executeDisposableRebuild(config, options, {
    migrate,
    getAdminPassword: password,
  });
  const repeat = await executeDisposableRebuild(config, options, {
    migrate,
    getAdminPassword: password,
  });
  if (
    first.report.status === 'COMPLETED_WITH_FAILURES' ||
    repeat.report.status === 'COMPLETED_WITH_FAILURES'
  )
    throw new Error('Rebuild contains unexpected failures');
  const same = JSON.stringify(first.report.snapshot) === JSON.stringify(repeat.report.snapshot);
  if (!same) throw new Error('Identical rerun changed the semantic snapshot');
  const result = {
    profile,
    status: 'PASS',
    timestamp: new Date().toISOString(),
    sourceManifestSha256: config.manifestSha256,
    target: planning.target,
    freshEmpty: planning.target.schemaObjects === 0,
    attempts,
    firstReport: first.reportPath,
    repeatReport: repeat.reportPath,
    snapshot: first.report.snapshot,
    identicalRerun: same,
    readiness: first.report.readiness,
  };
  await writeFile(
    path.join(process.env.PR8_RUN_ROOT, `${profile}-rebuild.json`),
    JSON.stringify(result, null, 2),
    { flag: 'wx' },
  );
  console.log(
    JSON.stringify({
      profile,
      status: result.status,
      identicalRerun: same,
      readiness: result.readiness,
    }),
  );
}
main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Acceptance failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
