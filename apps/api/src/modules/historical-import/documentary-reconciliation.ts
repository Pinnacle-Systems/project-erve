import { prisma } from '../../db/prisma.js';
import type { Prisma } from '../../db/prisma.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { recordAuditLog } from '../../audit/audit.service.js';

export interface DocumentaryCorrection {
  jobOrderId: string;
  styleId: string;
  legacyReference: string;
  sourceSha256: string;
  expectedDescription: string | null;
  expectedStyleName?: string | null;
  expectedDisclaimer: string | null;
  description: string;
  styleName?: string;
  disclaimer: string;
  /** Canonical staging snapshot for this same checksum-verified source PDF. */
  sourceSnapshot?: Prisma.InputJsonValue;
}

/** Internal controlled migration mechanics. The CLI proves the Dev target
 * and derives these values from the same canonical extraction as clean import.
 * All records are checked before any update; concurrent drift fails closed.
 */
export async function reconcileDocumentaryText(actor: CurrentUser, batchId: string, rows: DocumentaryCorrection[]) {
  if (!actor.roles.includes('ADMIN')) throw new Error('ADMIN required');
  if (new Set(rows.map((r) => r.jobOrderId)).size !== rows.length || new Set(rows.map((r) => r.styleId)).size !== rows.length) {
    throw new Error('Duplicate documentary correction identity');
  }
  return prisma.$transaction(async (tx) => {
    const changes = [];
    for (const row of [...rows].sort((a, b) => a.jobOrderId.localeCompare(b.jobOrderId))) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`job-order-${row.jobOrderId}`}))`;
      const jo = await tx.jobOrder.findUniqueOrThrow({ where: { id: row.jobOrderId }, include: {
        lines: { include: { style: true } }, historicalDocuments: { include: { historicalDocument: { include: { file: true } } } },
      } });
      if (jo.recordOrigin !== 'HISTORICAL_IMPORT' || jo.importBatchId !== batchId || jo.legacyReferenceNumber !== row.legacyReference || jo.lines.length !== 1 || jo.lines[0]!.styleId !== row.styleId) {
        throw new Error(`Historical identity mismatch: ${row.legacyReference}`);
      }
      const docs = jo.historicalDocuments.filter((d) => d.relationshipType === 'PRIMARY_SOURCE');
      if (docs.length !== 1 || docs[0]!.historicalDocument.file.checksumSha256 !== row.sourceSha256) throw new Error('Source evidence mismatch');
      if (row.sourceSnapshot) {
        const snapshot = row.sourceSnapshot as Record<string, unknown>;
        if (snapshot.sourceSha256 !== row.sourceSha256 ||
          (snapshot.effectiveFields as { description?: { value?: string } } | undefined)?.description?.value !== row.description ||
          (row.styleName !== undefined && (snapshot.effectiveFields as { styleName?: { value?: string } } | undefined)?.styleName?.value !== row.styleName) ||
          (snapshot.documentarySections as { jobOrderDisclaimer?: string } | undefined)?.jobOrderDisclaimer !== row.disclaimer) {
          throw new Error('Canonical source snapshot disagrees with documentary correction');
        }
      }
      const style = jo.lines[0]!.style;
      if (![row.expectedDescription, row.description].includes(style.description) || ![row.expectedDisclaimer, row.disclaimer].includes(jo.disclaimerText)) {
        throw new Error(`Text changed since audit: ${row.legacyReference}`);
      }
      if (row.styleName !== undefined && ![row.expectedStyleName, row.styleName].includes(style.styleName)) throw new Error(`Style name changed since audit: ${row.legacyReference}`);
      if (!row.description.trim() || !row.disclaimer.trim() || row.disclaimer.length > 10_000) throw new Error('Invalid documentary text');
      const otherUse = await tx.jobOrderLine.count({ where: { styleId: row.styleId, jobOrderId: { not: jo.id } } });
      if (otherUse) throw new Error(`Style is shared by another Job Order: ${row.legacyReference}`);
      changes.push({ row, jo, style, styleChanged: style.description !== row.description,
        styleNameChanged: row.styleName !== undefined && style.styleName !== row.styleName,
        disclaimerChanged: jo.disclaimerText !== row.disclaimer });
    }
    let stylesChanged = 0;
    let styleNamesChanged = 0;
    let disclaimersChanged = 0;
    for (const change of changes) {
      const { row, jo, style, styleChanged, styleNameChanged, disclaimerChanged } = change;
      if (styleChanged || styleNameChanged) {
        const updated = await tx.style.updateMany({ where: { id: style.id, description: style.description, styleName: style.styleName },
          data: { description: row.description, styleName: row.styleName ?? style.styleName } });
        if (updated.count !== 1) throw new Error('Style changed since audit');
        if (styleChanged) stylesChanged++;
        if (styleNameChanged) styleNamesChanged++;
      }
      if (disclaimerChanged) {
        const updated = await tx.jobOrder.updateMany({ where: { id: jo.id, version: jo.version, disclaimerText: jo.disclaimerText },
          data: { disclaimerText: row.disclaimer, disclaimerRevision: { increment: 1 }, version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error('Job Order changed since audit');
        disclaimersChanged++;
      }
      if (row.sourceSnapshot && (styleChanged || styleNameChanged || disclaimerChanged)) {
        await tx.historicalDocument.update({ where: { id: jo.historicalDocuments[0]!.historicalDocumentId },
          data: { sourceSnapshot: row.sourceSnapshot } });
      }
      if (styleChanged || styleNameChanged || disclaimerChanged) await recordAuditLog({ actorId: actor.id,
        action: 'HISTORICAL_DOCUMENTARY_TEXT_RECONCILED', entityType: 'HistoricalTextReconciliation', entityId: jo.id,
        metadata: { batchId, sourceSha256: row.sourceSha256, extractor: 'H2B.1', styleId: style.id,
          previousDescription: style.description, description: row.description,
          previousStyleName: style.styleName, styleName: row.styleName ?? style.styleName,
          previousDisclaimer: jo.disclaimerText, disclaimer: row.disclaimer },
      }, tx);
    }
    return { stylesChanged, styleNamesChanged, disclaimersChanged };
  }, { isolationLevel: 'Serializable', timeout: 60_000 });
}
