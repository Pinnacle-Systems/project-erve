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
      user: { select: currentUserSelect },
    },
  });
}

export async function rotateRefreshSessionToken(input: {
  sessionId: string;
  currentRefreshTokenHash: string;
  nextRefreshTokenHash: string;
  now: Date;
  idleExpiresAt: Date;
}): Promise<boolean> {
  const result = await prisma.refreshSession.updateMany({
    where: {
      id: input.sessionId,
      refreshTokenHash: input.currentRefreshTokenHash,
      revokedAt: null,
    },
    data: {
      refreshTokenHash: input.nextRefreshTokenHash,
      lastUsedAt: input.now,
      idleExpiresAt: input.idleExpiresAt,
    },
  });

  return result.count === 1;
}

export async function revokeRefreshSessionByToken(
  sessionId: string,
  refreshTokenHash: string,
  revokedAt: Date,
): Promise<void> {
  await prisma.refreshSession.updateMany({
    where: {
      id: sessionId,
      refreshTokenHash,
      revokedAt: null,
    },
    data: { revokedAt },
  });
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
