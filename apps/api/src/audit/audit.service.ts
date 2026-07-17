import { createId } from '@erve/shared';
import { prisma, type Prisma } from '../db/prisma.js';

export interface AuditLogEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
}

type AuditClient = Pick<typeof prisma, 'auditLog'>;

export async function recordAuditLog(
  entry: AuditLogEntry,
  client: AuditClient = prisma,
): Promise<void> {
  await client.auditLog.create({
    data: {
      id: createId(),
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: entry.metadata,
    },
  });
}
