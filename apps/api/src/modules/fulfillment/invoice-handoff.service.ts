import { createId } from '@erve/shared';
import { canMutateInvoiceHandoff, canViewInvoiceHandoff } from '@erve/shared';
import { Prisma, prisma } from '../../db/prisma.js';
import { getSoleDistributorId } from '../../auth/access.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { recordAuditLog } from '../../audit/audit.service.js';

type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Access helpers — mirror erve-dispatch.service.ts's broad-viewer pattern.
// Row-level scoping is resolved via the handoff's Erve Dispatch distributor.
// ---------------------------------------------------------------------------

function isBroadInvoiceHandoffViewer(actor: CurrentUser): boolean {
  return actor.roles.some((r) => r === 'ADMIN' || r === 'MERCHANDISER' || r === 'SENIOR_MANAGEMENT' || r === 'ACCOUNTANT');
}

function assertMutationAccess(actor: CurrentUser): void {
  if (!canMutateInvoiceHandoff(actor)) {
    throw HttpError.forbidden('You do not have permission to record Tally invoice references');
  }
}

function assertViewAccess(actor: CurrentUser, distributorId: string): void {
  if (!canViewInvoiceHandoff(actor)) {
    throw HttpError.forbidden('You do not have permission to view invoice handoffs');
  }
  if (!isBroadInvoiceHandoffViewer(actor) && getSoleDistributorId(actor) !== distributorId) {
    throw HttpError.forbidden('You do not have access to this invoice handoff');
  }
}

// ---------------------------------------------------------------------------
// View shaping
// ---------------------------------------------------------------------------

const invoiceHandoffInclude = {
  erveDispatch: {
    select: {
      id: true,
      erveDispatchNumber: true,
      dispatchDate: true,
      distributor: { select: { id: true, code: true, name: true } },
      saleOrder: { select: { id: true, saleOrderNumber: true } },
    },
  },
  saleOrderLine: {
    select: {
      id: true,
      purchaseOrderLineSize: {
        select: {
          sizeId: true,
          size: { select: { code: true, label: true } },
          purchaseOrderLine: {
            select: {
              styleId: true,
              style: { select: { styleNumber: true, styleName: true } },
              purchaseOrder: { select: { purchaseMode: true } },
            },
          },
        },
      },
    },
  },
  recordedBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.InvoiceHandoffInclude;

type InvoiceHandoffRecord = Prisma.InvoiceHandoffGetPayload<{ include: typeof invoiceHandoffInclude }>;

// `full` gates fields not safe for a Distributor caller — see the module
// task write-up: a Distributor may see the invoice number/date once
// recorded, never the internal Tally voucher reference, remarks, or who
// recorded it.
function toInvoiceHandoffView(record: InvoiceHandoffRecord, full: boolean) {
  const pols = record.saleOrderLine.purchaseOrderLineSize;
  return {
    id: record.id,
    erveDispatch: {
      id: record.erveDispatch.id,
      erveDispatchNumber: record.erveDispatch.erveDispatchNumber,
      dispatchDate: record.erveDispatch.dispatchDate.toISOString(),
    },
    saleOrder: record.erveDispatch.saleOrder,
    distributor: record.erveDispatch.distributor,
    // Business context only — resolved through the COMMERCIAL chain, never
    // stored. Does not affect handoff eligibility (see the schema module
    // doc): every physically dispatched line gets a handoff regardless.
    purchaseMode: pols.purchaseOrderLine.purchaseOrder.purchaseMode,
    saleOrderLineId: record.saleOrderLineId,
    style: { styleNumber: pols.purchaseOrderLine.style.styleNumber, styleName: pols.purchaseOrderLine.style.styleName },
    size: { sizeCode: pols.size.code, sizeLabel: pols.size.label },
    quantity: record.quantity,
    status: record.status,
    tallyInvoiceNumber: record.tallyInvoiceNumber,
    tallyInvoiceDate: record.tallyInvoiceDate?.toISOString() ?? null,
    tallyVoucherReference: full ? record.tallyVoucherReference : null,
    remarks: full ? record.remarks : null,
    recordedBy: full ? record.recordedBy : null,
    recordedAt: record.recordedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    version: record.version,
    updatedAt: record.updatedAt.toISOString(),
  };
}

async function loadInvoiceHandoff(id: string): Promise<InvoiceHandoffRecord> {
  const record = await prisma.invoiceHandoff.findUnique({ where: { id }, include: invoiceHandoffInclude });
  if (!record) throw HttpError.notFound('Invoice handoff not found');
  return record;
}

// ---------------------------------------------------------------------------
// Automatic "Dispatch Sale" handoff creation — called from
// erve-dispatch.service.ts inside the same transaction that records a real,
// physical ErveDispatch. EVERY physically dispatched SaleOrderLine gets a
// PENDING_TALLY handoff here, regardless of PurchaseMode: for OUTRIGHT this
// is the commercial sale itself; for SALE_RETURN it is the invoice/Tally
// linkage tied to the physical outward movement (GST/accounting), which is
// a separate fact from a Distributor's later-reported Actual Sale (see
// distributor-sales-report.service.ts, which deliberately never creates a
// handoff — the invoice for the physical movement already exists here).
// ---------------------------------------------------------------------------

export async function createInvoiceHandoffsForDispatch(
  tx: Tx,
  actor: CurrentUser,
  erveDispatchId: string,
  erveDispatchNumber: string,
  ervePackingListId: string,
): Promise<void> {
  const lines = await tx.factoryDispatchLine.findMany({
    where: { factoryDispatch: { ervePackingSource: { ervePackingListId } } },
    select: { saleOrderLineId: true, packedQuantity: true },
  });

  const quantityBySaleOrderLine = new Map<string, number>();
  for (const line of lines) {
    quantityBySaleOrderLine.set(line.saleOrderLineId, (quantityBySaleOrderLine.get(line.saleOrderLineId) ?? 0) + line.packedQuantity);
  }

  for (const [saleOrderLineId, quantity] of quantityBySaleOrderLine) {
    const id = createId();
    await tx.invoiceHandoff.create({ data: { id, erveDispatchId, saleOrderLineId, quantity, status: 'PENDING_TALLY' } });
    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'INVOICE_HANDOFF_CREATED',
        entityType: 'InvoiceHandoff',
        entityId: id,
        metadata: { erveDispatchId, erveDispatchNumber, saleOrderLineId, quantity },
      },
      tx,
    );
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getInvoiceHandoffDetail(actor: CurrentUser, id: string) {
  const record = await loadInvoiceHandoff(id);
  assertViewAccess(actor, record.erveDispatch.distributor.id);
  return toInvoiceHandoffView(record, isBroadInvoiceHandoffViewer(actor));
}

export async function getInvoiceHandoffList(
  actor: CurrentUser,
  filters: { status?: 'PENDING_TALLY' | 'INVOICED'; distributorId?: string; cursor?: string; limit: number },
) {
  if (!canViewInvoiceHandoff(actor)) {
    throw HttpError.forbidden('You do not have permission to view invoice handoffs');
  }
  const broad = isBroadInvoiceHandoffViewer(actor);
  const distributorId = broad ? filters.distributorId : getSoleDistributorId(actor);

  const records = await prisma.invoiceHandoff.findMany({
    where: { status: filters.status, erveDispatch: { distributorId } },
    include: invoiceHandoffInclude,
    orderBy: { id: 'desc' },
    take: filters.limit + 1,
    cursor: filters.cursor ? { id: filters.cursor } : undefined,
    skip: filters.cursor ? 1 : undefined,
  });
  const hasMore = records.length > filters.limit;
  const page = hasMore ? records.slice(0, filters.limit) : records;
  const items = page.map((record) => toInvoiceHandoffView(record, broad));
  return { items, pageInfo: { limit: filters.limit, hasMore, nextCursor: hasMore ? page.at(-1)!.id : null } };
}

// ---------------------------------------------------------------------------
// Recording / correcting the Tally reference. No uniqueness constraint on
// tallyInvoiceNumber: whether one Tally invoice may cover multiple handoff
// rows (consolidation across Dispatches) is an open business question the
// schema deliberately leaves unconstrained.
// ---------------------------------------------------------------------------

export interface RecordTallyInvoiceReferenceInput {
  expectedVersion: number;
  tallyInvoiceNumber: string;
  tallyInvoiceDate: string;
  tallyVoucherReference?: string | null;
  remarks?: string | null;
}

export async function recordTallyInvoiceReference(actor: CurrentUser, id: string, input: RecordTallyInvoiceReferenceInput) {
  assertMutationAccess(actor);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice-handoff-${id}`}))`;

    const existing = await tx.invoiceHandoff.findUnique({ where: { id } });
    if (!existing) throw HttpError.notFound('Invoice handoff not found');
    if (existing.version !== input.expectedVersion) throw HttpError.staleVersion(existing.version);

    const wasAlreadyInvoiced = existing.status === 'INVOICED';

    const updated = await tx.invoiceHandoff.updateMany({
      where: { id, version: input.expectedVersion },
      data: {
        status: 'INVOICED',
        tallyInvoiceNumber: input.tallyInvoiceNumber,
        tallyInvoiceDate: new Date(input.tallyInvoiceDate),
        tallyVoucherReference: input.tallyVoucherReference ?? null,
        remarks: input.remarks ?? null,
        recordedById: actor.id,
        recordedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw HttpError.staleVersion(existing.version);

    await recordAuditLog(
      {
        actorId: actor.id,
        action: wasAlreadyInvoiced ? 'TALLY_INVOICE_REFERENCE_UPDATED' : 'TALLY_INVOICE_RECORDED',
        entityType: 'InvoiceHandoff',
        entityId: id,
        metadata: { tallyInvoiceNumber: input.tallyInvoiceNumber, tallyInvoiceDate: input.tallyInvoiceDate },
      },
      tx,
    );
  });

  return getInvoiceHandoffDetail(actor, id);
}
