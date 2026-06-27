export interface AuditLogEntry {
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}

// Placeholder: logs to stdout for now. Once an AuditLog model is added to
// the Prisma schema, swap this for a write via db/prisma.ts.
export async function recordAuditLog(entry: AuditLogEntry): Promise<void> {
  console.log('[audit]', entry);
}
