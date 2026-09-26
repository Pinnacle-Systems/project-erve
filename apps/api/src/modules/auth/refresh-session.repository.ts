import { prisma } from '../../db/prisma.js';
import { currentUserSelect } from '../../auth/current-user.js';

export interface CreateRefreshSessionRecordInput {
  id: string;
  userId: string;
  refreshTokenHash: string;
  now: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

export async function createRefreshSessionRecord(
  input: CreateRefreshSessionRecordInput,
): Promise<void> {
  await prisma.refreshSession.create({
    data: {
      id: input.id,
      userId: input.userId,
      refreshTokenHash: input.refreshTokenHash,
      lastUsedAt: input.now,
      idleExpiresAt: input.idleExpiresAt,
      absoluteExpiresAt: input.absoluteExpiresAt,
    },
  });
}

export async function findRefreshSessionByToken(sessionId: string, refreshTokenHash: string) {
  return prisma.refreshSession.findFirst({
    where: {
      id: sessionId,
      refreshTokenHash,
    },
    select: {
      id: true,
      userId: true,
      refreshTokenHash: true,
      lastUsedAt: true,
      idleExpiresAt: true,
      absoluteExpiresAt: true,
      revokedAt: true,
      updatedAt: true,
      user: { select: currentUserSelect },
    },
  });
}

export async function findRefreshSessionById(sessionId: string) {
  return prisma.refreshSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
      refreshTokenHash: true,
      lastUsedAt: true,
      idleExpiresAt: true,
      absoluteExpiresAt: true,
      revokedAt: true,
      updatedAt: true,
      user: { select: currentUserSelect },
    },
  });
}

export async function rotateRefreshSessionToken(input: {
  sessionId: string;
  currentRefreshTokenHash: string;
  nextRefreshTokenHash: string;
  now: Date;
  /** Present only when the rotation reports user activity (slides idle expiry). */
  activity: { lastUsedAt: Date; idleExpiresAt: Date } | null;
}): Promise<boolean> {
  const result = await prisma.refreshSession.updateMany({
    where: {
      id: input.sessionId,
      refreshTokenHash: input.currentRefreshTokenHash,
      revokedAt: null,
    },
    data: {
      refreshTokenHash: input.nextRefreshTokenHash,
      ...input.activity,
      // Set explicitly (not left to Prisma's @updatedAt clock) because the
      // rotation grace window in refreshSession() measures from this instant
      // and must agree with the `now` the rotation was evaluated at.
      updatedAt: input.now,
    },
  });

  return result.count === 1;
}

export async function revokeRefreshSessionById(sessionId: string, revokedAt: Date): Promise<void> {
  await prisma.refreshSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt },
  });
}

export async function revokeAllRefreshSessionsForUser(
  userId: string,
  revokedAt: Date,
): Promise<void> {
  await prisma.refreshSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt },
  });
}
