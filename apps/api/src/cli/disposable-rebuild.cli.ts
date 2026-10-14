#!/usr/bin/env node
import 'dotenv/config';
import { readFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { prisma } from '../db/prisma.js';
import { RebuildSafetyError } from './disposable-rebuild-safety.js';
import { planDisposableRebuild, executeDisposableRebuild } from './disposable-rebuild.js';

async function applicationRoot() {
  const entryDirectory = path.dirname(fileURLToPath(import.meta.url));
  let directory = entryDirectory;
  while (true) {
    try {
      await access(path.join(directory, 'pnpm-workspace.yaml'));
      return directory;
    } catch {
      /* search parent */
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return path.dirname(entryDirectory); // packaged api/ CLI: keep generated data outside release/
}
async function migrationDirectory() {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    try {
      await access(path.join(directory, 'prisma.config.ts'));
      return directory;
    } catch {
      /* search parent */
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error('Committed Prisma config is unavailable');
    directory = parent;
  }
}
async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute'),
    plan = args.includes('--plan');
  if (execute === plan) throw new Error('Pass exactly one of --plan or --execute');
  const index = args.indexOf('--config');
  if (index < 0 || !args[index + 1])
    throw new Error('--config <sealed disposable rebuild JSON> is required');
  const config = JSON.parse(await readFile(args[index + 1]!, 'utf8'));
  const options = {
    execute,
    confirmWrite: args.includes('--confirm-write'),
    repositoryRoot: await applicationRoot(),
    developmentDatabaseUrl: process.env.REBUILD_DEVELOPMENT_DATABASE_URL,
  };
  if (!execute) {
    const result = await planDisposableRebuild(config, options);
    console.log(
      JSON.stringify(
        {
          mode: 'PLAN_NO_WRITES',
          target: result.target,
          manifestSha256: result.loaded.manifestSha256,
          sourcePreview: result.sourcePreview,
          inputChecksums: Object.fromEntries(
            Object.entries(result.loaded.files).map(([name, file]) => [name, file.sha256]),
          ),
          syntheticCorrectionCount: result.config.syntheticCorrections.length,
        },
        null,
        2,
      ),
    );
    return;
  }
  const require = createRequire(import.meta.url);
  const migrate = async () => {
    const cli = require.resolve('prisma/build/index.js');
    const cwd = await migrationDirectory();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [cli, 'migrate', 'deploy'], {
        cwd,
        env: process.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      // Do not echo process output: migration errors can include connection information.
      child.stdout.resume();
      child.stderr.resume();
      child.on('error', () => reject(new Error('Unable to start committed migrations')));
      child.on('close', (code) =>
        code === 0
          ? resolve()
          : reject(new Error('Committed migrations failed; inspect the disposable target')),
      );
    });
  };
  const result = await executeDisposableRebuild(config, options, {
    migrate,
    getAdminPassword: async () => {
      if (!process.env.ADMIN_PASSWORD_FILE)
        throw new Error('ADMIN_PASSWORD_FILE is required for a new disposable admin');
      return (await readFile(process.env.ADMIN_PASSWORD_FILE, 'utf8')).trimEnd();
    },
  });
  console.log(
    JSON.stringify(
      {
        status: result.report.status,
        reportPath: result.reportPath,
        readiness: result.report.readiness,
      },
      null,
      2,
    ),
  );
  if (result.report.status === 'COMPLETED_WITH_FAILURES') process.exitCode = 1;
  else if (result.report.status === 'COMPLETED_WITH_EXCEPTIONS') process.exitCode = 2;
}
main()
  .catch((error) => {
    console.error(
      error instanceof RebuildSafetyError
        ? error.message
        : 'Disposable rebuild refused or interrupted. Verify the explicit target, sealed inputs and recorded run stages.',
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
