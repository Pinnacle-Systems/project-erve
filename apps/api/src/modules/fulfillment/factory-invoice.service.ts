import { createId } from '@erve/shared';
import { canConfirmFactoryInvoice, canManageFactoryInvoiceFinancials, canViewFactoryInvoice } from '@erve/shared';
import { Prisma, prisma } from '../../db/prisma.js';
import { getSoleFactoryId } from '../../auth/access.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { recordAuditLog } from '../../audit/audit.service.js';

type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Access helpers
// ---------------------------------------------------------------------------

function isBroadFactoryInvoiceViewer(actor: CurrentUser): boolean {
  return actor.roles.some((r) => r === 'ADMIN' || r === 'ACCOUNTANT');
}

function assertViewAccess(actor: CurrentUser): void {
  if (!canViewFactoryInvoice(actor)) {
    throw HttpError.forbidden('You do not have permission to view Factory Invoices');
  }
}

function assertFactoryInvoiceRowAccess(actor: CurrentUser, invoiceFactoryId: string): void {
  if (isBroadFactoryInvoiceViewer(actor)) return;
  if (getSoleFactoryId(actor) !== invoiceFactoryId) {
    throw HttpError.forbidden('You do not have access to this Factory Invoice');
  }
}

function assertConfirmAccess(actor: CurrentUser): void {
  if (!canConfirmFactoryInvoice(actor)) {
    throw HttpError.forbidden('You do not have permission to confirm a Factory Invoice');
  }
}

function assertFinancialAccess(actor: CurrentUser): void {
  if (!canManageFactoryInvoiceFinancials(actor)) {
    throw HttpError.forbidden('You do not have permission to manage Factory Invoice financials');
  }
}

// ---------------------------------------------------------------------------
// View shaping
// ---------------------------------------------------------------------------

const factoryInvoiceInclude = {
  factory: { select: { id: true, code: true, name: true } },
  factoryDispatch: {
    select: {
      id: true,
      factoryDispatchNumber: true,
      saleOrder: { select: { id: true, saleOrderNumber: true } },
    },
  },
  factoryConfirmedBy: { select: { id: true, name: true, email: true } },
  finalizedBy: { select: { id: true, name: true, email: true } },
  lines: {
    include: {
      saleOrderLine: {
        select: {
          id: true,
          style: { select: { styleNumber: true, styleName: true } },
          size: { select: { code: true, label: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.FactoryInvoiceInclude;

type FactoryInvoiceRecord = Prisma.FactoryInvoiceGetPayload<{ include: typeof factoryInvoiceInclude }>;

function toFactoryInvoiceView(record: FactoryInvoiceRecord) {
  return {
    id: record.id,
    status: record.status,
    version: record.version,
    factory: record.factory,
    factoryDispatch: { id: record.factoryDispatch.id, factoryDispatchNumber: record.factoryDispatch.factoryDispatchNumber },
    saleOrder: record.factoryDispatch.saleOrder,
    generatedAt: record.generatedAt.toISOString(),
    factoryConfirmedBy: record.factoryConfirmedBy,
    factoryConfirmedAt: record.factoryConfirmedAt?.toISOString() ?? null,
    finalizedBy: record.finalizedBy,
    finalizedAt: record.finalizedAt?.toISOString() ?? null,
    subtotal: record.subtotal.toNumber(),
    gstAmount: record.gstAmount.toNumber(),
    total: record.total.toNumber(),
    remarks: record.remarks,
    lines: record.lines.map((line) => ({
      id: line.id,
      saleOrderLineId: line.saleOrderLineId,
      styleNumber: line.saleOrderLine.style.styleNumber,
      styleName: line.saleOrderLine.style.styleName,
      sizeCode: line.saleOrderLine.size.code,
      sizeLabel: line.saleOrderLine.size.label,
      quantity: line.quantity,
      defaultRate: line.defaultRate.toNumber(),
      unitRate: line.unitRate.toNumber(),
      lineAmount: line.lineAmount.toNumber(),
    })),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

async function loadFactoryInvoice(client: Tx | typeof prisma, id: string): Promise<FactoryInvoiceRecord> {
  const record = await client.factoryInvoice.findUnique({ where: { id }, include: factoryInvoiceInclude });
  if (!record) throw HttpError.notFound('Factory Invoice not found');
  return record;
}

// ---------------------------------------------------------------------------
// Generation — called from factory-dispatch.service.ts's finalizeFactoryDispatch,
// inside the SAME transaction that flips a FactoryDispatch to READY_FOR_ERVE,
// right after its own FACTORY_DISPATCH_FINALIZED audit log write. This is a
// data-integrity prerequisite of that one atomic finalization action, not a
// second independent workflow: a missing Style<->Factory rate fails the
// entire finalize call (the dispatch stays DRAFT) rather than leaving a
// READY_FOR_ERVE dispatch with no invoice. It never becomes a new gate on
// carton packing/Packing Audit themselves — those checks (see the `blockers`
// object in finalizeFactoryDispatch) already ran and passed before this is
// ever reached.
//
// Quantities are taken from `physicalPackedByLine` (the same
// getPhysicalPackedQuantitiesForLines Map finalizeFactoryDispatch already
// computed) rather than re-queried, per the single-quantity-copying-workflow
// requirement. The @@unique([factoryDispatchId]) constraint is the DB-level
// backstop against ever creating a second invoice for one Factory Dispatch.
// ---------------------------------------------------------------------------

interface FinalizedDispatchLine {
  id: string;
  styleId: string;
  style: { styleNumber: string; styleName: string };
}

export async function generateFactoryInvoiceForFinalizedDispatch(
  tx: Tx,
  actor: CurrentUser,
  dispatch: { id: string; factoryId: string; factoryDispatchNumber: string },
  saleOrderLines: FinalizedDispatchLine[],
  physicalPackedByLine: Map<string, number>,
): Promise<void> {
  const styleIds = [...new Set(saleOrderLines.map((l) => l.styleId))];
  const mappings = await tx.styleFactoryMapping.findMany({
    where: { factoryId: dispatch.factoryId, styleId: { in: styleIds }, status: 'ACTIVE' },
  });
  const rateByStyle = new Map(mappings.map((m) => [m.styleId, m.exFactoryPrice]));

  const missing = saleOrderLines.filter((line) => !rateByStyle.has(line.styleId));
  if (missing.length > 0) {
    const uniqueMissing = [...new Map(missing.map((l) => [l.styleId, l])).values()];
    throw HttpError.badRequest(
      'Cannot generate the Factory Invoice: no active Style↔Factory production rate exists for one or more styles at this Factory',
      {
        factoryId: dispatch.factoryId,
        missingRates: uniqueMissing.map((l) => ({ styleId: l.styleId, styleNumber: l.style.styleNumber, styleName: l.style.styleName })),
      },
    );
  }

  const lineInputs = saleOrderLines
    .map((line) => {
      const quantity = physicalPackedByLine.get(line.id) ?? 0;
      const rate = rateByStyle.get(line.styleId)!;
      return { saleOrderLineId: line.id, quantity, rate, lineAmount: rate.times(quantity) };
    })
    // Defensive only: finalizeFactoryDispatch's own blockers check already
    // guarantees every line's packed quantity equals its required (>0)
    // Dispatch Order quantity before this function is ever reached.
    .filter((l) => l.quantity > 0);

  const subtotal = lineInputs.reduce((sum, l) => sum.plus(l.lineAmount), new Prisma.Decimal(0));

  const invoice = await tx.factoryInvoice.create({
    data: {
      id: createId(),
      factoryDispatchId: dispatch.id,
      factoryId: dispatch.factoryId,
      status: 'GENERATED',
      subtotal,
      gstAmount: new Prisma.Decimal(0),
      total: subtotal,
      lines: {
        create: lineInputs.map((l) => ({
          id: createId(),
          saleOrderLineId: l.saleOrderLineId,
          quantity: l.quantity,
          defaultRate: l.rate,
          unitRate: l.rate,
          lineAmount: l.lineAmount,
        })),
      },
    },
  });

  await recordAuditLog(
    {
      actorId: actor.id,
      action: 'FACTORY_INVOICE_GENERATED',
      entityType: 'FactoryInvoice',
      entityId: invoice.id,
      metadata: {
        factoryDispatchId: dispatch.id,
        factoryDispatchNumber: dispatch.factoryDispatchNumber,
        lineCount: lineInputs.length,
        subtotal: subtotal.toNumber(),
      },
    },
    tx,
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getFactoryInvoiceDetail(actor: CurrentUser, id: string) {
  assertViewAccess(actor);
  const record = await loadFactoryInvoice(prisma, id);
  assertFactoryInvoiceRowAccess(actor, record.factoryId);
  return toFactoryInvoiceView(record);
}

export async function getFactoryInvoiceList(
  actor: CurrentUser,
  filters: { status?: 'GENERATED' | 'FACTORY_CONFIRMED' | 'FINALIZED'; factoryId?: string; cursor?: string; limit: number },
) {
  assertViewAccess(actor);
  const broad = isBroadFactoryInvoiceViewer(actor);
  const factoryId = broad ? filters.factoryId : getSoleFactoryId(actor);

  const records = await prisma.factoryInvoice.findMany({
    where: { status: filters.status, factoryId },
    include: factoryInvoiceInclude,
    orderBy: { id: 'desc' },
    take: filters.limit + 1,
    cursor: filters.cursor ? { id: filters.cursor } : undefined,
    skip: filters.cursor ? 1 : undefined,
  });
  const hasMore = records.length > filters.limit;
  const page = hasMore ? records.slice(0, filters.limit) : records;
  const items = page.map(toFactoryInvoiceView);
  return { items, pageInfo: { limit: filters.limit, hasMore, nextCursor: hasMore ? page.at(-1)!.id : null } };
}

// ---------------------------------------------------------------------------
// FACTORY_USER confirmation — one-way/idempotent. No expectedVersion (mirrors
// confirmCartonPackingAudit's idempotent no-CAS pattern): re-confirming an
// already-confirmed (or already-finalized) invoice is a harmless retry, never
// an error. An explicit switch on every status (rather than a blanket
// `!== 'GENERATED'` check) so a later status added to the enum can't
// silently fall through as a no-op success.
// ---------------------------------------------------------------------------

export async function confirmFactoryInvoice(actor: CurrentUser, id: string) {
  assertConfirmAccess(actor);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`factory-invoice-${id}`}))`;

    const invoice = await tx.factoryInvoice.findUnique({ where: { id } });
    if (!invoice) throw HttpError.notFound('Factory Invoice not found');
    assertFactoryInvoiceRowAccess(actor, invoice.factoryId);

    switch (invoice.status) {
      case 'FACTORY_CONFIRMED':
      case 'FINALIZED':
        return; // idempotent no-op: already confirmed (or confirmed-then-finalized)
      case 'GENERATED':
        break;
    }

    await tx.factoryInvoice.update({
      where: { id },
      data: { status: 'FACTORY_CONFIRMED', factoryConfirmedById: actor.id, factoryConfirmedAt: new Date(), version: { increment: 1 } },
    });

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'FACTORY_INVOICE_FACTORY_CONFIRMED',
        entityType: 'FactoryInvoice',
        entityId: id,
        metadata: { factoryDispatchId: invoice.factoryDispatchId },
      },
      tx,
    );
  });

  return getFactoryInvoiceDetail(actor, id);
}

// ---------------------------------------------------------------------------
// ACCOUNTANT financial edits — permitted only between FACTORY_CONFIRMED and
// FINALIZED. Desired-state PATCH: computes the proposed values FIRST and, if
// nothing actually differs from current, returns early with no version bump
// and no audit entry (mirrors updateFactoryPackingCarton's no-op detection).
// Never touches Style/Size/quantity/Factory/source references — those simply
// aren't in the input schema (factory-invoice.validation.ts is `.strict()`).
// ---------------------------------------------------------------------------

export interface UpdateFactoryInvoiceFinancialsInput {
  expectedVersion: number;
  lines?: Array<{ id: string; unitRate: number }>;
  gstAmount?: number;
  remarks?: string | null;
}

export async function updateFactoryInvoiceFinancials(actor: CurrentUser, id: string, input: UpdateFactoryInvoiceFinancialsInput) {
  assertFinancialAccess(actor);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`factory-invoice-${id}`}))`;

    const invoice = await tx.factoryInvoice.findUnique({ where: { id }, include: { lines: true } });
    if (!invoice) throw HttpError.notFound('Factory Invoice not found');
    if (invoice.version !== input.expectedVersion) throw HttpError.staleVersion(invoice.version);
    if (invoice.status === 'GENERATED') {
      throw HttpError.badRequest('The Factory must confirm this invoice before financial values can be edited');
    }
    if (invoice.status === 'FINALIZED') {
      throw HttpError.badRequest('A finalized Factory Invoice cannot be edited');
    }

    const lineById = new Map(invoice.lines.map((l) => [l.id, l]));
    const rateChanges: Array<{ lineId: string; saleOrderLineId: string; quantity: number; oldRate: Prisma.Decimal; newRate: Prisma.Decimal }> = [];
    for (const entry of input.lines ?? []) {
      const line = lineById.get(entry.id);
      if (!line) throw HttpError.badRequest(`Line ${entry.id} does not belong to this invoice`);
      const newRate = new Prisma.Decimal(entry.unitRate);
      if (!newRate.equals(line.unitRate)) {
        rateChanges.push({ lineId: line.id, saleOrderLineId: line.saleOrderLineId, quantity: line.quantity, oldRate: line.unitRate, newRate });
      }
    }

    const newGst = input.gstAmount != null ? new Prisma.Decimal(input.gstAmount) : invoice.gstAmount;
    const gstChanged = !newGst.equals(invoice.gstAmount);
    const newRemarks = input.remarks !== undefined ? input.remarks : invoice.remarks;
    const remarksChanged = newRemarks !== invoice.remarks;

    if (rateChanges.length === 0 && !gstChanged && !remarksChanged) {
      return; // no-op/retry: leave version, audit and totals untouched
    }

    for (const change of rateChanges) {
      await tx.factoryInvoiceLine.update({
        where: { id: change.lineId },
        data: { unitRate: change.newRate, lineAmount: change.newRate.times(change.quantity) },
      });
    }

    const allLines = await tx.factoryInvoiceLine.findMany({ where: { factoryInvoiceId: id } });
    const subtotal = allLines.reduce((sum, l) => sum.plus(l.lineAmount), new Prisma.Decimal(0));
    const total = subtotal.plus(newGst);

    await tx.factoryInvoice.update({
      where: { id },
      data: { subtotal, gstAmount: newGst, total, remarks: newRemarks, version: { increment: 1 } },
    });

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'FACTORY_INVOICE_FINANCIAL_UPDATED',
        entityType: 'FactoryInvoice',
        entityId: id,
        metadata: {
          factoryDispatchId: invoice.factoryDispatchId,
          rateChanges: rateChanges.map((c) => ({
            saleOrderLineId: c.saleOrderLineId,
            oldUnitRate: c.oldRate.toNumber(),
            newUnitRate: c.newRate.toNumber(),
          })),
          ...(gstChanged ? { gstAmount: { old: invoice.gstAmount.toNumber(), new: newGst.toNumber() } } : {}),
          ...(remarksChanged ? { remarks: { old: invoice.remarks, new: newRemarks } } : {}),
        },
      },
      tx,
    );
  });

  return getFactoryInvoiceDetail(actor, id);
}

// ---------------------------------------------------------------------------
// ACCOUNTANT finalization — requires FACTORY_CONFIRMED. Recomputes
// subtotal/total fresh from the stored lines server-side (authoritative,
// never trusting the cached value) before persisting. After this commits the
// invoice is immutable: every other mutation here rejects a FINALIZED
// invoice outright.
// ---------------------------------------------------------------------------

export async function finalizeFactoryInvoice(actor: CurrentUser, id: string, input: { expectedVersion: number }) {
  assertFinancialAccess(actor);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`factory-invoice-${id}`}))`;

    const invoice = await tx.factoryInvoice.findUnique({ where: { id }, include: { lines: true } });
    if (!invoice) throw HttpError.notFound('Factory Invoice not found');
    if (invoice.version !== input.expectedVersion) throw HttpError.staleVersion(invoice.version);
    if (invoice.status !== 'FACTORY_CONFIRMED') {
      throw HttpError.badRequest('Only a Factory-confirmed invoice can be finalized');
    }

    const subtotal = invoice.lines.reduce((sum, l) => sum.plus(l.lineAmount), new Prisma.Decimal(0));
    const total = subtotal.plus(invoice.gstAmount);

    const updated = await tx.factoryInvoice.updateMany({
      where: { id, version: input.expectedVersion },
      data: { status: 'FINALIZED', finalizedById: actor.id, finalizedAt: new Date(), subtotal, total, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw HttpError.staleVersion(invoice.version);

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'FACTORY_INVOICE_FINALIZED',
        entityType: 'FactoryInvoice',
        entityId: id,
        metadata: { factoryDispatchId: invoice.factoryDispatchId, subtotal: subtotal.toNumber(), gstAmount: invoice.gstAmount.toNumber(), total: total.toNumber() },
      },
      tx,
    );
  });

  return getFactoryInvoiceDetail(actor, id);
}
