import { randomUUID } from 'node:crypto';
import { prisma } from '../db/prisma.js';
import { gstinVerificationRepository } from '../modules/gst-compliance/gstin-verification.repository.js';
import type { VerificationIntent } from '../modules/gst-compliance/gstin-verification.service.js';
import { createTestUser } from './helpers.js';

export const LIVE_GSTIN = '33AAAAA0000A1Z5';
export const DEMO_REQUESTED_GSTIN = '33BBBBB0000B1Z6';

export interface HeldOptions {
  kind: 'UNCERTAIN' | 'DISPATCHED';
  mode?: 'LIVE' | 'DEMO';
  level?: 'BASIC' | 'COMPLETE';
  gstin?: string;
  /** Moves dispatchedAt (and completedAt for UNCERTAIN) this far into the past. */
  ageMinutes?: number;
}

export function buildIntent(
  options: { mode?: 'LIVE' | 'DEMO'; level?: 'BASIC' | 'COMPLETE'; gstin?: string } = {},
): VerificationIntent {
  const mode = options.mode ?? 'LIVE';
  return {
    id: randomUUID(),
    actorId: 'fixture-actor',
    target: { gstin: options.gstin ?? LIVE_GSTIN },
    mode,
    level: options.level ?? 'BASIC',
    settingsVersion: 1,
    refresh: false,
    cacheEvidenceId: null,
    estimatedCredits: mode === 'DEMO' ? 0 : 1,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 5 * 60_000),
    outcome: 'PREPARED',
  };
}
export const keyOf = (intent: VerificationIntent) =>
  `${intent.mode}:${intent.target.gstin}:${intent.level}`;

/** Drives the real repository, so the claim and operation are exactly what production writes. */
export async function createHeldOperation(options: HeldOptions) {
  const intent = buildIntent(options);
  await gstinVerificationRepository.prepare(intent);
  if (!(await gstinVerificationRepository.claim(intent, keyOf(intent))))
    throw new Error('fixture claim was not acquired');
  if (options.kind === 'UNCERTAIN') await gstinVerificationRepository.fail(intent, 'NETWORK', true);
  if (options.ageMinutes) {
    const past = (minutes: number) => new Date(Date.now() - minutes * 60_000);
    await prisma.gstVerificationOperation.update({
      where: { id: intent.id },
      data: {
        dispatchedAt: past(options.ageMinutes),
        ...(options.kind === 'UNCERTAIN' ? { completedAt: past(options.ageMinutes - 1) } : {}),
      },
    });
    await prisma.gstVerificationClaim.update({
      where: { operationId: intent.id },
      data: { reviewAfter: past(options.ageMinutes - 2) },
    });
  }
  return { intent, key: keyOf(intent) };
}

export async function createOperator(
  roles: Array<'ACCOUNTANT' | 'ADMIN' | 'MERCHANDISER'>,
  status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE',
) {
  const email = `operator-${randomUUID().slice(0, 8)}@gst-claims.test`;
  const userId = await createTestUser({ email, password: 'Fixture-pass-123!', roles, status });
  return { email, userId };
}
