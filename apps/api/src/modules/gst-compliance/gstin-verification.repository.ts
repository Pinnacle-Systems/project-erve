import type {
  GstRegistrationProfile,
  GstVerificationEvidence,
  GstVerificationFailure,
  GstVerificationSource,
} from '@erve/types';
import { normalizeGstin } from '@erve/shared';
import { prisma, type Prisma } from '../../db/prisma.js';
import { HttpError } from '../../errors/http-error.js';
import type { VerificationIntent, VerificationRepository } from './gstin-verification.service.js';

type EvidenceRow = Prisma.GstVerificationEvidenceGetPayload<object>;
function evidenceDto(row: EvidenceRow): GstVerificationEvidence {
  return {
    ...(row.profile as unknown as GstRegistrationProfile),
    id: row.id,
    requestedGstin: row.requestedGstin,
    normalizedGstin: row.normalizedGstin,
    lookupGstin: row.lookupGstin,
    returnedGstin: row.returnedGstin,
    mode: row.mode,
    level: row.level,
    retrievedAt: row.retrievedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    ttlSeconds: row.ttlSeconds,
    estimatedCredits: row.estimatedCredits,
    actualCredits: row.actualCredits,
    billingCategory: row.billingCategory,
  };
}
function intentDto(row: Prisma.GstVerificationOperationGetPayload<object>): VerificationIntent {
  return {
    id: row.id,
    actorId: row.actorId,
    target: {
      gstin: row.requestedGstin,
      ...(row.sourceType && row.sourceId
        ? { source: { type: row.sourceType as GstVerificationSource['type'], id: row.sourceId } }
        : {}),
    },
    mode: row.mode,
    level: row.level,
    settingsVersion: row.settingsVersion,
    cacheEvidenceId: row.cacheEvidenceId,
    refresh: row.refresh,
    estimatedCredits: row.estimatedCredits,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    outcome: row.outcome,
  };
}
export const gstinVerificationRepository: VerificationRepository = {
  async evidence(normalizedGstin, mode) {
    // No history limit on cache selection: repeated Basic refreshes cannot hide
    // still-fresh Complete coverage. At most one latest row per coverage is needed.
    const rows = await Promise.all(
      (['BASIC', 'COMPLETE'] as const).map((level) =>
        prisma.gstVerificationEvidence.findFirst({
          where: { normalizedGstin, mode, level },
          orderBy: [{ retrievedAt: 'desc' }, { id: 'desc' }],
        }),
      ),
    );
    return rows
      .filter((row): row is EvidenceRow => row !== null)
      .sort((a, b) => b.retrievedAt.getTime() - a.retrievedAt.getTime())
      .map(evidenceDto);
  },
  async latestFailure(normalizedGstin, mode, source) {
    const row = await prisma.gstVerificationOperation.findFirst({
      where: {
        normalizedGstin,
        mode,
        ...(source ? { sourceType: source.type, sourceId: source.id } : {}),
        outcome: { in: ['SUCCEEDED', 'FAILED', 'UNCERTAIN'] },
      },
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      select: { failureCode: true },
    });
    return row?.failureCode && row.failureCode !== 'CANCELLED'
      ? (row.failureCode as GstVerificationFailure)
      : null;
  },
  async history(normalizedGstin, mode, source) {
    const rows = await prisma.gstVerificationOperation.findMany({
      where: {
        normalizedGstin,
        mode,
        ...(source ? { sourceType: source.type, sourceId: source.id } : {}),
        outcome: { not: 'PREPARED' },
      },
      include: { evidence: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    // Account balance, raw errors and actor credentials never enter business DTOs.
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      outcome: row.outcome,
      failureCode:
        row.failureCode && row.failureCode !== 'CANCELLED'
          ? (row.failureCode as GstVerificationFailure)
          : null,
      refresh: row.refresh,
      estimatedCredits: row.estimatedCredits,
      evidence: row.evidence ? evidenceDto(row.evidence) : null,
    }));
  },
  async prepare(intent) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'gst-verification-intents'}))`;
      const count = await tx.gstVerificationOperation.count({
        where: { actorId: intent.actorId, createdAt: { gt: new Date(Date.now() - 60_000) } },
      });
      if (count >= 10)
        throw new HttpError(
          429,
          'GST_RATE_LIMITED',
          'Too many verification requests. Try again later.',
        );
      await tx.gstVerificationOperation.create({
        data: {
          id: intent.id,
          actorId: intent.actorId,
          requestedGstin: intent.target.gstin,
          normalizedGstin: normalizeGstin(intent.target.gstin),
          sourceType: intent.target.source?.type,
          sourceId: intent.target.source?.id,
          mode: intent.mode,
          level: intent.level,
          settingsVersion: intent.settingsVersion,
          cacheEvidenceId: intent.cacheEvidenceId,
          refresh: intent.refresh,
          estimatedCredits: intent.estimatedCredits,
          createdAt: intent.createdAt,
          expiresAt: intent.expiresAt,
        },
      });
    });
  },
  async intent(id) {
    const row = await prisma.gstVerificationOperation.findUnique({ where: { id } });
    return row ? intentDto(row) : null;
  },
  async claim(intent, key) {
    return prisma.$transaction(async (tx) => {
      // One short transaction serializes rate accounting and claim acquisition.
      // It ends before HTTP. A crash after this commit is conservatively uncertain.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'gst-verification-execution'}))`;
      const current = await tx.gstVerificationOperation.findUnique({ where: { id: intent.id } });
      if (!current || current.outcome !== 'PREPARED' || current.expiresAt <= new Date())
        return false;
      if (await tx.gstVerificationClaim.findUnique({ where: { key } })) return false;
      const since = new Date(Date.now() - 60_000);
      const globalCount = await tx.gstVerificationOperation.count({
        where: { dispatchedAt: { gt: since } },
      });
      const actorCount = await tx.gstVerificationOperation.count({
        where: { actorId: intent.actorId, dispatchedAt: { gt: since } },
      });
      // The documented new-account tier is 10/minute (verified accounts 60).
      // Use the lowest tier until an account-specific policy is authorized.
      if (globalCount >= 10 || actorCount >= 5)
        throw new HttpError(
          429,
          'GST_RATE_LIMITED',
          'Too many verification requests. Try again later.',
        );
      await tx.gstVerificationClaim.create({
        data: { key, operationId: intent.id, reviewAfter: new Date(Date.now() + 120_000) },
      });
      await tx.gstVerificationOperation.update({
        where: { id: intent.id },
        data: { outcome: 'DISPATCHED', dispatchedAt: new Date() },
      });
      return true;
    });
  },
  async complete(intent, evidence, balance) {
    const {
      id,
      requestedGstin,
      normalizedGstin,
      lookupGstin,
      returnedGstin,
      mode,
      level,
      retrievedAt,
      expiresAt,
      ttlSeconds,
      estimatedCredits,
      actualCredits,
      billingCategory,
      ...profile
    } = evidence;
    await prisma.$transaction(async (tx) => {
      await tx.gstVerificationEvidence.create({
        data: {
          id,
          operationId: intent.id,
          requestedGstin,
          normalizedGstin,
          lookupGstin,
          returnedGstin,
          mode,
          level,
          retrievedAt: new Date(retrievedAt),
          expiresAt: new Date(expiresAt),
          ttlSeconds,
          estimatedCredits,
          actualCredits,
          billingCategory,
          profile: profile as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.gstVerificationOperation.update({
        where: { id: intent.id },
        data: { outcome: 'SUCCEEDED', completedAt: new Date(), providerBalance: balance },
      });
      await tx.gstVerificationClaim.deleteMany({ where: { operationId: intent.id } });
    });
  },
  async fail(intent, failureCode, uncertain) {
    await prisma.$transaction(async (tx) => {
      await tx.gstVerificationOperation.update({
        where: { id: intent.id },
        data: { outcome: uncertain ? 'UNCERTAIN' : 'FAILED', failureCode, completedAt: new Date() },
      });
      if (!uncertain)
        await tx.gstVerificationClaim.deleteMany({ where: { operationId: intent.id } });
    });
  },
  async cacheHit(intent) {
    await prisma.$transaction(async (tx) => {
      await tx.gstVerificationOperation.update({
        where: { id: intent.id },
        data: { outcome: 'CACHE_HIT', completedAt: new Date() },
      });
      await tx.gstVerificationClaim.deleteMany({ where: { operationId: intent.id } });
    });
  },
};
