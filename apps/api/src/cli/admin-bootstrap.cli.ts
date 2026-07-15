#!/usr/bin/env node
// Idempotent production-safe admin user bootstrap.
//
// Usage (from apps/api, or the packaged api/ release directory):
//   ADMIN_EMAIL=... ADMIN_NAME=... ADMIN_PASSWORD_FILE=/path/to/password \
//     node admin-bootstrap.js [--reset-password] [--confirm-production]
//
// See DEPLOYMENT.md ("Admin user bootstrap") for the full operations guide.
import { readFile } from 'node:fs/promises';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { runAdminBootstrap, AdminBootstrapError, type AdminBootstrapResult } from './admin-bootstrap.js';

function parseArgs(argv: string[]): { resetPassword: boolean; confirmProduction: boolean } {
  const resetPassword = argv.includes('--reset-password');
  const confirmProduction = argv.includes('--confirm-production');
  return { resetPassword, confirmProduction };
}

async function readPasswordFile(path: string): Promise<string> {
  const raw = await readFile(path, 'utf8');
  return raw.replace(/\r?\n+$/, '');
}

// Character codes read from raw stdin below — avoided as literal escape
// sequences in string/case literals so the source stays unambiguous.
const KEY_ENTER_LF = 10; // \n
const KEY_ENTER_CR = 13; // \r
const KEY_CTRL_D = 4;
const KEY_CTRL_C = 3;
const KEY_BACKSPACE = 8;
const KEY_DEL = 127;

// Non-echoing interactive prompt — no third-party dependency, no readline
// internals. Requires a real TTY; refuses otherwise so a password is never
// silently read from a redirected/empty stdin as an empty string.
function promptHiddenPassword(query: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new AdminBootstrapError('Cannot prompt for a password: stdin is not a TTY.'));
      return;
    }

    process.stdout.write(query);
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');

    let input = '';
    const onData = (char: string): void => {
      const code = char.charCodeAt(0);

      if (code === KEY_ENTER_LF || code === KEY_ENTER_CR || code === KEY_CTRL_D) {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(input);
        return;
      }

      if (code === KEY_CTRL_C) {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        reject(new AdminBootstrapError('Prompt cancelled.'));
        return;
      }

      if (code === KEY_BACKSPACE || code === KEY_DEL) {
        input = input.slice(0, -1);
        return;
      }

      input += char;
    };
    stdin.on('data', onData);
  });
}

// Precedence: ADMIN_PASSWORD_FILE (safest for automation) > ADMIN_PASSWORD
// (documented fallback) > interactive prompt (safest for a human operator
// running this by hand, but requires a TTY). Resolved lazily by the caller
// only when a password is actually needed.
function makePasswordResolver(): () => Promise<string> {
  let cached: string | undefined;
  return async () => {
    if (cached !== undefined) {
      return cached;
    }
    if (process.env.ADMIN_PASSWORD_FILE) {
      cached = await readPasswordFile(process.env.ADMIN_PASSWORD_FILE);
      return cached;
    }
    if (process.env.ADMIN_PASSWORD) {
      cached = process.env.ADMIN_PASSWORD;
      return cached;
    }
    cached = await promptHiddenPassword('Admin password: ');
    return cached;
  };
}

function describeResult(result: AdminBootstrapResult): string {
  // Role reference data is ensured on every successful run regardless of
  // outcome (see admin-bootstrap.ts) — surfaced here only when something
  // was actually missing and got created, so the common case ("already
  // configured", nothing to ensure) stays a single clean line.
  const roleNote =
    result.rolesEnsured.length > 0 ? ` (ensured missing role reference data: ${result.rolesEnsured.join(', ')})` : '';

  switch (result.outcome) {
    case 'created':
      return `created: admin user "${result.email}" created with the ADMIN role${roleNote}`;
    case 'already_configured':
      return `already configured: "${result.email}" already has the ADMIN role — no changes made${roleNote}`;
    case 'role_added':
      return `admin role added: "${result.email}" was missing the ADMIN role — added it${roleNote}`;
    case 'password_reset':
      return result.roleAdded
        ? `admin role added; password reset: "${result.email}"${roleNote}`
        : `password reset: "${result.email}"${roleNote}`;
  }
}

async function main(): Promise<void> {
  const { resetPassword, confirmProduction } = parseArgs(process.argv.slice(2));

  const email = process.env.ADMIN_EMAIL;
  const name = process.env.ADMIN_NAME;

  if (!email || !name) {
    throw new AdminBootstrapError('ADMIN_EMAIL and ADMIN_NAME environment variables are required.');
  }

  const result = await runAdminBootstrap(
    {
      email,
      name,
      resetPassword,
      confirmProduction,
      nodeEnv: env.NODE_ENV,
      getPassword: makePasswordResolver(),
    },
    { databaseUrl: env.DATABASE_URL },
  );

  console.log(describeResult(result));
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error: unknown) => {
    if (error instanceof AdminBootstrapError) {
      console.error(error.message);
    } else {
      console.error('Unexpected error while bootstrapping the admin user:');
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
