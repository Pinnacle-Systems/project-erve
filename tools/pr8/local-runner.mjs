// Launches PR8-owned local processes; credentials remain in external private files.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { assertExternalArtifactRoot, repositoryRoots } from './artifact-safety.mjs';
const repository = resolve(import.meta.dirname, '../..');
const api = join(repository, 'apps/api');
const require = createRequire(join(api, 'package.json'));
const values = require('dotenv').parse(readFileSync(join(api, '.env')));
const { Client } = createRequire(require.resolve('@prisma/adapter-pg'))('pg');
const [action, directory, profile = 'first'] = process.argv.slice(2);
if (
  !directory ||
  ![
    'setup',
    'rebuild',
    'corrected-rebuild',
    'correction',
    'operational',
    'api',
    'web',
    'tests',
  ].includes(action)
)
  throw Error(
    'Usage: local-runner.mjs setup|rebuild|correction|operational|api|web|tests <external-run-directory> [first|second|interruption|regression]',
  );
if (!['first', 'second', 'interruption', 'regression'].includes(profile))
  throw Error('Unknown target profile');
const output = resolve(directory),
  configFile = join(
    output,
    action === 'corrected-rebuild' ? 'synthetic-correction-config.json' : `${profile}-config.json`,
  );
await assertExternalArtifactRoot(output, repositoryRoots(repository));
const source = JSON.parse(readFileSync(join(output, 'source-config.json')));
const template = new URL(values.TEST_DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(template.hostname))
  throw Error('Nonlocal setup endpoint refused');
if (action === 'setup') {
  if (existsSync(configFile)) throw Error('Existing config must be preserved');
  const disposableId = randomBytes(16).toString('hex');
  const databaseName = `erve_rebuild_pr8_${profile}_${disposableId.slice(0, 12)}_test`;
  template.pathname = '/postgres';
  const client = new Client({ connectionString: template.href });
  await client.connect();
  try {
    const identity = (
      await client.query(
        'SELECT current_database() AS name, inet_server_addr()::text AS address, version() AS version',
      )
    ).rows[0];
    if (identity.name !== 'postgres' || identity.address !== source.expectedServerAddress)
      throw Error('Live server does not match the explicitly reviewed source config');
    await client.query(`CREATE DATABASE ${databaseName}`);
    const config = {
      ...source,
      disposableId,
      databaseName,
      reportRoot: join(output, `rebuild-${disposableId}`),
      mediaRoot: join(output, `media-${disposableId}`),
      syntheticCorrections: [],
    };
    mkdirSync(output, { recursive: true });
    writeFileSync(configFile, JSON.stringify(config, null, 2), { flag: 'wx' });
    writeFileSync(join(output, `${profile}-password.txt`), randomBytes(24).toString('base64url'), {
      flag: 'wx',
      mode: 0o600,
    });
    writeFileSync(
      join(output, `${profile}-server-identity.json`),
      JSON.stringify({ ...identity, databaseName, mediaRoot: config.mediaRoot }, null, 2),
      { flag: 'wx' },
    );
    console.log(`Provisioned ${databaseName} on verified ${identity.address}`);
  } finally {
    await client.end();
  }
} else {
  const config = JSON.parse(readFileSync(configFile));
  template.pathname = `/${config.databaseName}`;
  const client = new Client({ connectionString: template.href });
  await client.connect();
  try {
    const identity = (
      await client.query(
        "SELECT current_database() AS name, inet_server_addr()::text AS address, shobj_description(oid, 'pg_database') AS owner FROM pg_database WHERE datname=current_database()",
      )
    ).rows[0];
    if (
      identity.name !== config.databaseName ||
      identity.address !== config.expectedServerAddress ||
      !/^erve_rebuild_pr8_.*_test$/.test(identity.name)
    )
      throw Error('Disposable target identity mismatch');
    if (
      ['api', 'correction', 'operational'].includes(action) &&
      !identity.owner?.startsWith(`erve-disposable-rebuild:v1:${config.disposableId}:`)
    )
      throw Error('Target must have verified PR8 rebuild ownership');
    console.log(`Verified ${identity.name} at ${identity.address}; media=${config.mediaRoot}`);
  } finally {
    await client.end();
  }
  const environment = {
    ...process.env,
    ...values,
    DATABASE_URL: template.href,
    TEST_DATABASE_URL: template.href,
    NODE_ENV: 'test',
    FILE_STORAGE_DIR: config.mediaRoot,
    ADMIN_PASSWORD_FILE: join(output, `${profile}-password.txt`),
    HOST: '127.0.0.1',
    PORT: '4188',
    CORS_ORIGIN: 'http://127.0.0.1:5188',
    VITE_API_URL: 'http://127.0.0.1:4188',
    PR8_CONFIG: configFile,
    PR8_RUN_ROOT: output,
  };
  let args,
    cwd = api;
  if (action === 'rebuild' || action === 'corrected-rebuild')
    args = ['--import', 'tsx/esm', join(api, 'src/cli/pr8-rebuild-acceptance.ts')];
  if (action === 'correction')
    args = ['--import', 'tsx/esm', join(api, 'src/cli/pr8-correction-acceptance.ts')];
  if (action === 'operational')
    args = ['--import', 'tsx/esm', join(api, 'src/cli/pr8-operational-acceptance.ts')];
  if (action === 'api') args = ['--import', 'tsx/esm', join(api, 'src/server.ts')];
  if (action === 'web') {
    cwd = join(repository, 'apps/web');
    const viteRequire = createRequire(join(cwd, 'package.json'));
    args = [
      resolve(viteRequire.resolve('vite/package.json'), '../bin/vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      '5188',
      '--strictPort',
    ];
  }
  if (action === 'tests') {
    if (profile !== 'regression')
      throw Error('Regression tests cannot truncate acceptance targets');
    const migration = spawn(
      process.execPath,
      [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
      { cwd: api, env: environment, windowsHide: true, stdio: 'inherit' },
    );
    await new Promise((ok, fail) => {
      migration.on('error', fail);
      migration.on('exit', (code) =>
        code === 0 ? ok() : fail(new Error('Regression migrations failed')),
      );
    });
    environment.DATABASE_URL = values.DATABASE_URL;
    args = [
      resolve(require.resolve('vitest/package.json'), '../vitest.mjs'),
      'run',
      'src/cli/disposable-rebuild.cli.test.ts',
      'src/cli/disposable-rebuild-inputs.test.ts',
      'src/cli/disposable-rebuild-ownership.test.ts',
      'src/cli/disposable-rebuild-outcomes.test.ts',
      'src/cli/disposable-rebuild-safety.test.ts',
      'src/cli/pr8-acceptance-state.test.ts',
      'src/cli/pr8-source-fidelity.test.ts',
      'src/modules/master-data/master-import.service.test.ts',
      'src/modules/master-data/master-import.routes.test.ts',
      'src/modules/master-data/master-import.parser.test.ts',
      'src/modules/master-data/style-bulk-import.test.ts',
      'src/modules/master-data/style-bulk-import.routes.test.ts',
      'src/modules/master-data/style-bulk-import-reliability.test.ts',
      'src/modules/master-data/style-bulk-import-metadata.test.ts',
    ];
  }
  const child = spawn(process.execPath, args, {
    cwd,
    env: environment,
    windowsHide: true,
    stdio: 'inherit',
  });
  await new Promise((ok, fail) => {
    child.on('error', fail);
    child.on('exit', (code) => {
      process.exitCode = code;
      ok();
    });
  });
}
