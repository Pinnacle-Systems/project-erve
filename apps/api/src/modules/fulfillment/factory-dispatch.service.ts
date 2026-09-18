import { createId } from '@erve/shared';
import {
  canConfirmPackingAudit,
  canMutateFactoryDispatch,
  canViewFactoryDispatch,
  canViewPackingAudit,
  canReadFactoryDispatchBroadly,
} from '@erve/shared';
import { Prisma, prisma } from '../../db/prisma.js';
import { getSoleFactoryId } from '../../auth/access.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import { ensureFinancialYear } from '../master-data/financial-year.service.js';
import { allocateDocumentSerial } from '../master-data/document-sequence.service.js';
import { DOCUMENT_PREFIXES, formatDocumentNumber } from '../master-data/document-number.util.js';
import { getPhysicalPackedQuantitiesForLines, reconcileFactoryDispatchLineAttribution } from './packing-reconciliation.js';
import { generateFactoryInvoiceForFinalizedDispatch } from './factory-invoice.service.js';
import { listFactories } from '../master-data/master-data.service.js';

type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Access helpers
// ---------------------------------------------------------------------------

function assertMutationAccess(actor: CurrentUser): void {
  if (!canMutateFactoryDispatch(actor)) {
    throw HttpError.forbidden('You do not have permission to manage Factory Dispatches');
  }
}

function assertViewAccess(actor: CurrentUser): void {
  if (!canViewFactoryDispatch(actor)) {
    throw HttpError.forbidden('You do not have permission to view Factory Dispatches');
  }
}

// null means "no restriction" — ADMIN/MERCHANDISER/SENIOR_MANAGEMENT read
// broadly (UXAUTH-004; see canReadFactoryDispatchBroadly/
// FACTORY_DISPATCH_BROAD_READ_ROLES, the single shared definition of "broad"
// also consumed by the Web selector-visibility check and by
// getFactoryPackingQueue below). Every other view role — currently just
// FACTORY_USER — is scoped to its own single mapped Factory. This is a READ
// scope only; mutation authority is governed independently by
// assertMutationAccess/canMutateFactoryDispatch, which additively includes
// FACTORY_USER regardless of what other roles an account also holds.
function resolveActorFactoryScope(actor: CurrentUser): string | null {
  if (canReadFactoryDispatchBroadly(actor)) return null;
  return getSoleFactoryId(actor);
}

function assertFactoryRowAccess(actor: CurrentUser, dispatchFactoryId: string): void {
  const scope = resolveActorFactoryScope(actor);
  if (scope !== null && scope !== dispatchFactoryId) {
    throw HttpError.forbidden('You do not have access to this Factory Dispatch');
  }
}

// Packing Audit authority is QA_USER-only (ADMIN views but never confirms —
// see rbac.ts's PACKING_AUDIT_MUTATION_ROLES doc comment). QA_USER is
// deliberately NOT factory-scoped here — it mirrors the existing, already
// cross-factory Job-Order-QA inspection workflow rather than introducing a
// new per-role factory-mapping capability (userFactory mappings are
// enforced server-side to FACTORY_USER only; see users.service.ts).
function assertPackingAuditMutationAccess(actor: CurrentUser): void {
  if (!canConfirmPackingAudit(actor)) {
    throw HttpError.forbidden('You do not have permission to confirm a Packing Audit');
  }
}

function assertPackingAuditViewAccess(actor: CurrentUser): void {
  if (!canViewPackingAudit(actor)) {
    throw HttpError.forbidden('You do not have permission to view Packing Audit records');
  }
}

// ---------------------------------------------------------------------------
// Document numbering
// ---------------------------------------------------------------------------

async function generateFactoryDispatchNumber(
  client: Tx,
  financialYear: { id: string; code: string },
): Promise<{ factoryDispatchNumber: string; factoryDispatchSerial: number }> {
  const serial = await allocateDocumentSerial(client, 'FACTORY_DISPATCH', financialYear.id);
  return {
    factoryDispatchNumber: formatDocumentNumber(DOCUMENT_PREFIXES.FACTORY_DISPATCH, financialYear.code, serial),
    factoryDispatchSerial: serial,
  };
}

// ---------------------------------------------------------------------------
// Packing List projection — the primary, Dispatch-Order-centric read (Phase
// 4 plan §2). Readable the moment a Dispatch Order exists; requires no
// FactoryDispatch id and creates nothing. Both getDispatchOrderPackingList
// (sale-orders.service.ts, Dispatch-Order-keyed) and getFactoryDispatchDetail
// (below, factory-dispatch-keyed) build on this single projection so there is
// exactly one packing-list read implementation.
// ---------------------------------------------------------------------------

export type AuditState = 'NOT_INSPECTED' | 'INSPECTED' | 'NEEDS_REINSPECTION';

export interface PackingListCartonAuditHistoryEntry {
  cartonVersion: number;
  inspectedById: string;
  inspectedByName: string;
  inspectedAt: string;
  remarks: string | null;
}

export interface PackingListCartonView {
  id: string;
  cartonNumber: string;
  destinationId: string;
  packageDetails: string | null;
  weight: string | null;
  version: number;
  totalQuantity: number;
  destinationMismatch: boolean;
  auditState: AuditState;
  retired: boolean;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
  lines: Array<{
    saleOrderLineId: string;
    styleId: string;
    styleNumber: string;
    styleName: string;
    sizeId: string;
    sizeCode: string;
    sizeLabel: string;
    quantity: number;
    currentDestinationId: string;
  }>;
  auditHistory: PackingListCartonAuditHistoryEntry[];
}

export interface PackingListLineView {
  saleOrderLineId: string;
  styleId: string;
  styleNumber: string;
  styleName: string;
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  requiredQuantity: number;
  packedQuantity: number;
}

export interface PackingListDestinationView {
  id: string;
  // Correction 8: a Dispatch Order may now contain destinations belonging to
  // several Distributors — this per-destination field is what makes the
  // owning Distributor obvious when selecting a destination for a carton
  // (the carton itself never carries a distributor field, only destinationId).
  distributor: { id: string; code: string; name: string };
  label: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  country: string;
  postalCode: string | null;
  gstin: string | null;
  lines: PackingListLineView[];
  cartons: PackingListCartonView[];
}

export interface PackingListView {
  saleOrderId: string;
  saleOrderNumber: string;
  // Deduplicated list of every Distributor represented in this Dispatch
  // Order (Correction 8 — replaces the old singular `distributor` field,
  // which assumed exactly one Distributor per Dispatch Order). The Factory
  // Packing List still mirrors the WHOLE Dispatch Order quantitatively
  // (one FPL per DO, never per-Distributor) — this is a header-level summary
  // only; per-destination ownership is on PackingListDestinationView.
  distributors: Array<{ id: string; code: string; name: string }>;
  factory: { id: string; code: string; name: string };
  factoryDispatch:
    | { id: string; factoryDispatchNumber: string; status: 'DRAFT' | 'READY_FOR_ERVE'; version: number; factoryInvoiceId: string | null }
    | null;
  destinations: PackingListDestinationView[];
  retiredCartons: PackingListCartonView[];
}

const packingListCartonInclude = {
  destination: {
    select: {
      id: true,
      label: true,
      city: true,
      state: true,
      saleOrderDistributor: { select: { distributor: { select: { id: true, code: true, name: true } } } },
    },
  },
  createdBy: { select: { id: true, name: true } },
  retiredBy: { select: { id: true, name: true } },
  lines: {
    include: {
      saleOrderLine: {
        select: {
          id: true,
          destinationId: true,
          style: { select: { id: true, styleNumber: true, styleName: true } },
          size: { select: { id: true, code: true, label: true } },
        },
      },
    },
  },
  audits: {
    include: { inspectedBy: { select: { id: true, name: true } } },
    orderBy: { inspectedAt: 'desc' as const },
  },
} satisfies Prisma.FactoryPackingCartonInclude;

type CartonRecord = Prisma.FactoryPackingCartonGetPayload<{ include: typeof packingListCartonInclude }>;

function toCartonAuditHistory(carton: CartonRecord): PackingListCartonAuditHistoryEntry[] {
  return carton.audits.map((audit) => ({
    cartonVersion: audit.cartonVersion,
    inspectedById: audit.inspectedById,
    inspectedByName: audit.inspectedBy.name,
    inspectedAt: audit.inspectedAt.toISOString(),
    remarks: audit.remarks,
  }));
}

function toPackingListCartonView(carton: CartonRecord): PackingListCartonView {
  const currentAudit = carton.audits.find((a) => a.cartonVersion === carton.version) ?? null;
  const auditState: AuditState = currentAudit ? 'INSPECTED' : carton.audits.length > 0 ? 'NEEDS_REINSPECTION' : 'NOT_INSPECTED';
  const destinationMismatch = carton.lines.some((line) => line.saleOrderLine.destinationId !== carton.destinationId);
  return {
    id: carton.id,
    cartonNumber: carton.cartonNumber,
    destinationId: carton.destinationId,
    packageDetails: carton.packageDetails,
    weight: carton.weight?.toString() ?? null,
    version: carton.version,
    totalQuantity: carton.lines.reduce((sum, l) => sum + l.quantity, 0),
    destinationMismatch,
    auditState,
    retired: carton.retiredAt !== null,
    retiredAt: carton.retiredAt?.toISOString() ?? null,
    createdAt: carton.createdAt.toISOString(),
    updatedAt: carton.updatedAt.toISOString(),
    lines: carton.lines.map((line) => ({
      saleOrderLineId: line.saleOrderLineId,
      styleId: line.saleOrderLine.style.id,
      styleNumber: line.saleOrderLine.style.styleNumber,
      styleName: line.saleOrderLine.style.styleName,
      sizeId: line.saleOrderLine.size.id,
      sizeCode: line.saleOrderLine.size.code,
      sizeLabel: line.saleOrderLine.size.label,
      quantity: line.quantity,
      currentDestinationId: line.saleOrderLine.destinationId,
    })),
    auditHistory: toCartonAuditHistory(carton),
  };
}

// Pure projection builder — no auth. Callers (getDispatchOrderPackingList in
// sale-orders.service.ts, getFactoryDispatchDetail below) each perform their
// own access check before calling this.
export async function buildPackingListProjection(order: { id: string; factoryId: string }): Promise<PackingListView> {
  const [saleOrder, destinations, lines, dispatch, cartons] = await Promise.all([
    prisma.saleOrder.findUniqueOrThrow({
      where: { id: order.id },
      select: {
        saleOrderNumber: true,
        factory: { select: { id: true, code: true, name: true } },
      },
    }),
    prisma.saleOrderDestination.findMany({
      where: { saleOrderId: order.id },
      include: { saleOrderDistributor: { include: { distributor: { select: { id: true, code: true, name: true } } } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.saleOrderLine.findMany({
      where: { saleOrderId: order.id },
      include: {
        style: { select: { id: true, styleNumber: true, styleName: true } },
        size: { select: { id: true, code: true, label: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.factoryDispatch.findUnique({ where: { saleOrderId: order.id } }),
    prisma.factoryPackingCarton.findMany({
      where: { factoryDispatch: { saleOrderId: order.id } },
      include: packingListCartonInclude,
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const physicalPackedByLine = await getPhysicalPackedQuantitiesForLines(
    prisma,
    lines.map((l) => l.id),
  );
  const factoryInvoice = dispatch
    ? await prisma.factoryInvoice.findUnique({ where: { factoryDispatchId: dispatch.id }, select: { id: true } })
    : null;

  const cartonViews = cartons.map(toPackingListCartonView);
  const activeCartonsByDestination = new Map<string, PackingListCartonView[]>();
  const retiredCartons: PackingListCartonView[] = [];
  for (const view of cartonViews) {
    if (view.retired) {
      retiredCartons.push(view);
      continue;
    }
    const list = activeCartonsByDestination.get(view.destinationId) ?? [];
    list.push(view);
    activeCartonsByDestination.set(view.destinationId, list);
  }

  const linesByDestination = new Map<string, PackingListLineView[]>();
  for (const line of lines) {
    const view: PackingListLineView = {
      saleOrderLineId: line.id,
      styleId: line.style.id,
      styleNumber: line.style.styleNumber,
      styleName: line.style.styleName,
      sizeId: line.size.id,
      sizeCode: line.size.code,
      sizeLabel: line.size.label,
      requiredQuantity: line.quantity,
      packedQuantity: physicalPackedByLine.get(line.id) ?? 0,
    };
    const list = linesByDestination.get(line.destinationId) ?? [];
    list.push(view);
    linesByDestination.set(line.destinationId, list);
  }

  const distributorsById = new Map<string, { id: string; code: string; name: string }>();
  for (const destination of destinations) distributorsById.set(destination.saleOrderDistributor.distributor.id, destination.saleOrderDistributor.distributor);

  return {
    saleOrderId: order.id,
    saleOrderNumber: saleOrder.saleOrderNumber,
    distributors: [...distributorsById.values()],
    factory: saleOrder.factory,
    factoryDispatch: dispatch
      ? {
          id: dispatch.id,
          factoryDispatchNumber: dispatch.factoryDispatchNumber,
          status: dispatch.status,
          version: dispatch.version,
          factoryInvoiceId: factoryInvoice?.id ?? null,
        }
      : null,
    destinations: destinations.map((destination) => ({
      id: destination.id,
      distributor: destination.saleOrderDistributor.distributor,
      label: destination.label,
      contactName: destination.contactName,
      contactEmail: destination.contactEmail,
      contactPhone: destination.contactPhone,
      addressLine1: destination.addressLine1,
      addressLine2: destination.addressLine2,
      city: destination.city,
      state: destination.state,
      country: destination.country,
      postalCode: destination.postalCode,
      gstin: destination.gstin,
      lines: linesByDestination.get(destination.id) ?? [],
      cartons: activeCartonsByDestination.get(destination.id) ?? [],
    })),
    retiredCartons,
  };
}

export async function getFactoryDispatchDetail(actor: CurrentUser, id: string) {
  assertViewAccess(actor);
  const dispatch = await prisma.factoryDispatch.findUnique({ where: { id }, select: { factoryId: true, saleOrderId: true } });
  if (!dispatch) throw HttpError.notFound('Factory dispatch not found');
  assertFactoryRowAccess(actor, dispatch.factoryId);
  return buildPackingListProjection({ id: dispatch.saleOrderId, factoryId: dispatch.factoryId });
}

export async function getFactoryDispatchList(
  actor: CurrentUser,
  filters: {
    status?: 'DRAFT' | 'READY_FOR_ERVE';
    saleOrderId?: string;
    factoryId?: string;
    unconsolidatedOnly?: boolean;
    cursor?: string;
    limit: number;
  },
) {
  assertViewAccess(actor);
  const scope = resolveActorFactoryScope(actor);
  const factoryId = scope ?? filters.factoryId;

  // Phase 6: "consolidated" is now carton-level (a Factory Dispatch's
  // cartons may be split across several destination-specific Erve Packing
  // Lists — see FactoryPackingCarton.ervePackingListId) rather than the
  // legacy whole-batch ErvePackingListSource join, which the carton-based
  // flow never writes to. unconsolidatedOnly means "has at least one active
  // carton not yet claimed by any Erve Packing List".
  const where: Prisma.FactoryDispatchWhereInput = {
    factoryId,
    status: filters.status,
    saleOrderId: filters.saleOrderId,
    cartons: filters.unconsolidatedOnly ? { some: { retiredAt: null, ervePackingListId: null } } : undefined,
  };

  const records = await prisma.factoryDispatch.findMany({
    where,
    select: {
      id: true,
      factoryDispatchNumber: true,
      status: true,
      version: true,
      preparedAt: true,
      finalizedAt: true,
      saleOrderId: true,
      factory: { select: { id: true, code: true, name: true } },
      saleOrder: {
        select: {
          id: true,
          saleOrderNumber: true,
          distributorGroups: { select: { distributor: { select: { id: true, code: true, name: true } } } },
        },
      },
      cartons: { where: { retiredAt: null }, select: { ervePackingListId: true } },
    },
    orderBy: { id: 'desc' },
    take: filters.limit + 1,
    cursor: filters.cursor ? { id: filters.cursor } : undefined,
    skip: filters.cursor ? 1 : undefined,
  });
  const hasMore = records.length > filters.limit;
  const page = hasMore ? records.slice(0, filters.limit) : records;
  return {
    items: page.map((record) => ({
      id: record.id,
      factoryDispatchNumber: record.factoryDispatchNumber,
      factory: record.factory,
      saleOrder: {
        id: record.saleOrder.id,
        saleOrderNumber: record.saleOrder.saleOrderNumber,
        // Correction 8: a Dispatch Order may now involve several
        // Distributors — replaces the old singular `distributor` field.
        distributors: record.saleOrder.distributorGroups.map((g) => g.distributor),
      },
      status: record.status,
      version: record.version,
      preparedAt: record.preparedAt.toISOString(),
      finalizedAt: record.finalizedAt?.toISOString() ?? null,
      consolidated: record.cartons.length > 0 && record.cartons.every((c) => c.ervePackingListId !== null),
    })),
    pageInfo: { limit: filters.limit, hasMore, nextCursor: hasMore ? page.at(-1)!.id : null },
  };
}

// ---------------------------------------------------------------------------
// Factory Packing Queue (business-level progress: required vs. physical
// carton-packed quantity — Factory never sees/selects a StockAllocation/
// QaReleaseLine/Job Order, and never sees an internal allocation split)
// ---------------------------------------------------------------------------

export async function getFactoryPackingQueue(actor: CurrentUser, requestedFactoryId?: string) {
  assertViewAccess(actor);

  let factoryId: string;
  if (canReadFactoryDispatchBroadly(actor)) {
    if (requestedFactoryId) factoryId = requestedFactoryId;
    else if (actor.factoryIds.length === 1) factoryId = actor.factoryIds[0]!;
    else throw HttpError.badRequest('factoryId is required');
  } else {
    factoryId = getSoleFactoryId(actor);
  }

  const lines = await prisma.saleOrderLine.findMany({
    where: { saleOrder: { factoryId } },
    select: {
      id: true,
      quantity: true,
      style: { select: { id: true, styleNumber: true, styleName: true } },
      size: { select: { id: true, code: true, label: true } },
      saleOrder: { select: { id: true, saleOrderNumber: true } },
      // Correction 8: resolved per line via its own destination's
      // Distributor-group — a Dispatch Order may span several Distributors,
      // so this can no longer be read off the order root.
      destination: { select: { saleOrderDistributor: { select: { distributor: { select: { id: true, code: true, name: true } } } } } },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (lines.length === 0) return [];

  const packedByLine = await getPhysicalPackedQuantitiesForLines(
    prisma,
    lines.map((l) => l.id),
  );

  return lines
    .map((line) => {
      const packedQuantity = packedByLine.get(line.id) ?? 0;
      return {
        saleOrderId: line.saleOrder.id,
        saleOrderNumber: line.saleOrder.saleOrderNumber,
        distributor: line.destination.saleOrderDistributor.distributor,
        saleOrderLineId: line.id,
        styleId: line.style.id,
        styleNumber: line.style.styleNumber,
        styleName: line.style.styleName,
        sizeId: line.size.id,
        sizeCode: line.size.code,
        sizeLabel: line.size.label,
        allocatedQuantity: line.quantity,
        packedQuantity,
        remainingQuantity: line.quantity - packedQuantity,
      };
    })
    .filter((row) => row.remainingQuantity > 0);
}

// ---------------------------------------------------------------------------
// Factory options — the minimal lookup that backs the Web Factory context
// selector for broad readers (UXAUTH-005). Deliberately NOT the same
// endpoint as GET /factories (master-data.routes.ts's canViewFactories),
// which is gated ADMIN/MERCHANDISER only and would 403 for
// SENIOR_MANAGEMENT — this route instead reuses FACTORY_DISPATCH_BROAD_READ_
// ROLES, the same capability that already governs Factory Dispatch reads, so
// the selector's own data source can never fall out of step with who is
// allowed to use it. FACTORY_USER never calls this — it doesn't use the
// selector — so it is intentionally excluded from this route's guard.
// ---------------------------------------------------------------------------

export interface FactoryOption {
  id: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
}

function assertBroadFactoryReadAccess(actor: CurrentUser): void {
  if (!canReadFactoryDispatchBroadly(actor)) {
    throw HttpError.forbidden('You do not have permission to list Factories for the packing context selector');
  }
}

export async function getFactoryOptions(actor: CurrentUser): Promise<FactoryOption[]> {
  assertBroadFactoryReadAccess(actor);
  // Deliberately no status filter — broad readers need to keep selecting a
  // Factory that has since been made INACTIVE to reach its historical
  // Factory Dispatches (INACTIVE only blocks new creation elsewhere in this
  // codebase, e.g. sale-orders.service.ts's "Factory is not active" check —
  // it has never gated a read).
  const factories = await listFactories(actor, {});
  return factories.map(({ id, code, name, status }) => ({ id, code, name, status }));
}

// ---------------------------------------------------------------------------
// Deletion (one Dispatch Order -> one FactoryDispatch packing root)
// ---------------------------------------------------------------------------

// Explicit child-first deletion order. Used for the "abandon whole DRAFT
// Factory Dispatch" action and the Dispatch-Order Factory-change path — both
// are deliberate full resets, so audit history is discarded along with
// everything else (unlike single-carton removal, which retires an audited
// carton instead of deleting it — see removeFactoryPackingCarton).
export async function hardDeleteFactoryDispatches(tx: Tx, factoryDispatchIds: string[]): Promise<number> {
  if (factoryDispatchIds.length === 0) return 0;
  const cartons = await tx.factoryPackingCarton.findMany({
    where: { factoryDispatchId: { in: factoryDispatchIds } },
    select: { id: true },
  });
  const cartonIds = cartons.map((c) => c.id);
  if (cartonIds.length > 0) {
    await tx.factoryPackingCartonAudit.deleteMany({ where: { cartonId: { in: cartonIds } } });
    await tx.factoryPackingCartonLine.deleteMany({ where: { cartonId: { in: cartonIds } } });
    await tx.factoryPackingCarton.deleteMany({ where: { id: { in: cartonIds } } });
  }
  await tx.factoryDispatchLine.deleteMany({ where: { factoryDispatchId: { in: factoryDispatchIds } } });
  const result = await tx.factoryDispatch.deleteMany({ where: { id: { in: factoryDispatchIds } } });
  return result.count;
}

export async function deleteFactoryDispatch(actor: CurrentUser, id: string, input: { expectedVersion: number }) {
  assertMutationAccess(actor);

  await prisma.$transaction(async (tx) => {
    const pre = await tx.factoryDispatch.findUnique({ where: { id }, select: { saleOrderId: true } });
    if (!pre) throw HttpError.notFound('Factory dispatch not found');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sale-order-${pre.saleOrderId}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`factory-dispatch-${id}`}))`;

    const dispatch = await tx.factoryDispatch.findUnique({ where: { id } });
    if (!dispatch) throw HttpError.notFound('Factory dispatch not found');
    if (dispatch.version !== input.expectedVersion) throw HttpError.staleVersion(dispatch.version);
    if (dispatch.status !== 'DRAFT') {
      throw HttpError.badRequest('Only a DRAFT Factory Dispatch may be abandoned; finalized packing cannot be deleted');
    }
    assertFactoryRowAccess(actor, dispatch.factoryId);

    await hardDeleteFactoryDispatches(tx, [id]);
    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'FACTORY_DISPATCH_DELETED',
        entityType: 'FactoryDispatch',
        entityId: id,
        metadata: { factoryDispatchNumber: dispatch.factoryDispatchNumber },
      },
      tx,
    );
  });
}

// ---------------------------------------------------------------------------
// Cartons — the sole physical packing fact (Phase 4). Carton create is
// keyed by the Dispatch Order, not the FactoryDispatch (which may not exist
// yet) — see routes.ts / the Phase 4 plan §2 and §5's first-carton lock
// sequence. Update/delete/audit are keyed by the FactoryDispatch since the
// carton (and therefore its parent) necessarily already exists by then.
// ---------------------------------------------------------------------------

export interface CartonLineInput {
  saleOrderLineId: string;
  quantity: number;
}

export interface CreateCartonInput {
  cartonNumber: string;
  destinationId: string;
  packageDetails?: string | null;
  weight?: number | null;
  lines: CartonLineInput[];
}

function validateCartonLinesShape(lines: CartonLineInput[]): void {
  const ids = lines.map((l) => l.saleOrderLineId);
  if (new Set(ids).size !== ids.length) {
    throw HttpError.badRequest('Each carton line must reference a distinct Dispatch Order line');
  }
}

// Carton create, keyed by the Dispatch Order (saleOrderId) — the
// FactoryDispatch packing root may not exist yet. Exact lock sequence
// (Phase 4 plan §2/§5): acquire sale-order-{id}; look up FactoryDispatch;
// create it while still holding the sale-order lock if absent; only THEN
// acquire factory-dispatch-{id}; revalidate DRAFT; mutate.
export async function addFactoryPackingCarton(actor: CurrentUser, saleOrderId: string, input: CreateCartonInput) {
  assertMutationAccess(actor);
  validateCartonLinesShape(input.lines);

  const cartonId = createId();
  let factoryDispatchId!: string;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sale-order-${saleOrderId}`}))`;

    const order = await tx.saleOrder.findUnique({
      where: { id: saleOrderId },
      include: { lines: true, destinations: { select: { id: true } } },
    });
    if (!order) throw HttpError.notFound('Dispatch order not found');
    // Checked BEFORE any write (including the get-or-create below) so an
    // unauthorized request against another Factory's order never creates
    // that order's FactoryDispatch root as a side effect of being rejected.
    assertFactoryRowAccess(actor, order.factoryId);
    if (!order.destinations.some((d) => d.id === input.destinationId)) {
      throw HttpError.badRequest('Destination does not belong to this dispatch order');
    }

    let dispatch = await tx.factoryDispatch.findUnique({ where: { saleOrderId } });
    if (!dispatch) {
      const financialYear = await ensureFinancialYear(tx, new Date());
      const { factoryDispatchNumber, factoryDispatchSerial } = await generateFactoryDispatchNumber(tx, financialYear);
      dispatch = await tx.factoryDispatch.create({
        data: {
          id: createId(),
          factoryDispatchNumber,
          factoryId: order.factoryId,
          saleOrderId,
          status: 'DRAFT',
          preparedById: actor.id,
          financialYearId: financialYear.id,
          factoryDispatchSerial,
        },
      });
    }
    factoryDispatchId = dispatch.id;

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`factory-dispatch-${dispatch.id}`}))`;
    const current = await tx.factoryDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
    if (current.status !== 'DRAFT') throw HttpError.badRequest('Cartons can only be added to a DRAFT Factory Dispatch');

    const linesById = new Map(order.lines.map((l) => [l.id, l]));
    for (const entry of input.lines) {
      const line = linesById.get(entry.saleOrderLineId);
      if (!line) throw HttpError.badRequest(`Line ${entry.saleOrderLineId} does not belong to this dispatch order`);
      if (line.destinationId !== input.destinationId) {
        throw HttpError.badRequest(
          `Line ${entry.saleOrderLineId} belongs to a different destination — a carton may only contain lines for its own destination`,
        );
      }
    }

    const existingPacked = await getPhysicalPackedQuantitiesForLines(
      tx,
      input.lines.map((l) => l.saleOrderLineId),
    );
    for (const entry of input.lines) {
      const line = linesById.get(entry.saleOrderLineId)!;
      const already = existingPacked.get(entry.saleOrderLineId) ?? 0;
      if (already + entry.quantity > line.quantity) {
        throw HttpError.conflict(
          `Carton quantity for line ${entry.saleOrderLineId} would exceed its Dispatch Order quantity (${line.quantity})`,
        );
      }
    }

    const duplicateCartonNumber = await tx.factoryPackingCarton.findUnique({
      where: { factoryDispatchId_cartonNumber: { factoryDispatchId: dispatch.id, cartonNumber: input.cartonNumber } },
    });
    if (duplicateCartonNumber) {
      throw HttpError.badRequest(`Carton number ${input.cartonNumber} already exists on this Factory Dispatch`);
    }

    await tx.factoryPackingCarton.create({
      data: {
        id: cartonId,
        factoryDispatchId: dispatch.id,
        destinationId: input.destinationId,
        cartonNumber: input.cartonNumber,
        packageDetails: input.packageDetails ?? null,
        weight: input.weight ?? null,
        createdById: actor.id,
        lines: {
          create: input.lines.map((entry) => ({ id: createId(), saleOrderLineId: entry.saleOrderLineId, quantity: entry.quantity })),
        },
      },
    });

    for (const entry of input.lines) {
      await reconcileFactoryDispatchLineAttribution(tx, dispatch.id, entry.saleOrderLineId);
    }

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'CARTON_CREATED',
        entityType: 'FactoryPackingCarton',
        entityId: cartonId,
        metadata: { saleOrderId, factoryDispatchId: dispatch.id, cartonNumber: input.cartonNumber, destinationId: input.destinationId },
      },
      tx,
    );
  });

  return getFactoryDispatchDetail(actor, factoryDispatchId);
}

export interface UpdateCartonInput {
  expectedVersion: number;
  destinationId: string;
  packageDetails?: string | null;
  weight?: number | null;
  lines: CartonLineInput[];
}

function normalizedLineKey(lines: CartonLineInput[]): string {
  return [...lines]
    .map((l) => `${l.saleOrderLineId}:${l.quantity}`)
    .sort()
    .join('|');
}

// Desired-state carton update. Normalizes and diffs current vs. desired
// state FIRST — bumps carton.version (invalidating a current Packing Audit)
// only when something inspection-relevant actually changed (destination,
// packageDetails, weight, content-line membership/quantities). A no-op/
// retry PATCH is inert: no version bump, no audit invalidation, no
// CARTON_UPDATED/CARTON_CONTENT_CHANGED log entry.
export async function updateFactoryPackingCarton(
  actor: CurrentUser,
  factoryDispatchId: string,
  cartonId: string,
  input: UpdateCartonInput,
) {
  assertMutationAccess(actor);
  validateCartonLinesShape(input.lines);

  await prisma.$transaction(async (tx) => {
    const pre = await tx.factoryDispatch.findUnique({ where: { id: factoryDispatchId }, select: { saleOrderId: true } });
    if (!pre) throw HttpError.notFound('Factory dispatch not found');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sale-order-${pre.saleOrderId}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`factory-dispatch-${factoryDispatchId}`}))`;

    const dispatch = await tx.factoryDispatch.findUnique({ where: { id: factoryDispatchId } });
    if (!dispatch) throw HttpError.notFound('Factory dispatch not found');
    if (dispatch.status !== 'DRAFT') throw HttpError.badRequest('Cartons can only be edited on a DRAFT Factory Dispatch');
    assertFactoryRowAccess(actor, dispatch.factoryId);

    const carton = await tx.factoryPackingCarton.findUnique({
      where: { id: cartonId },
      include: { lines: true },
    });
    if (!carton || carton.factoryDispatchId !== factoryDispatchId) throw HttpError.notFound('Carton not found');
    if (carton.retiredAt) throw HttpError.badRequest('This carton has been retired and can no longer be edited');
    if (carton.version !== input.expectedVersion) throw HttpError.staleVersion(carton.version);

    const order = await tx.saleOrder.findUniqueOrThrow({
      where: { id: pre.saleOrderId },
      include: { lines: true, destinations: { select: { id: true } } },
    });
    if (!order.destinations.some((d) => d.id === input.destinationId)) {
      throw HttpError.badRequest('Destination does not belong to this dispatch order');
    }
    const linesById = new Map(order.lines.map((l) => [l.id, l]));
    for (const entry of input.lines) {
      const line = linesById.get(entry.saleOrderLineId);
      if (!line) throw HttpError.badRequest(`Line ${entry.saleOrderLineId} does not belong to this dispatch order`);
      if (line.destinationId !== input.destinationId) {
        throw HttpError.badRequest(
          `Line ${entry.saleOrderLineId} belongs to a different destination — a carton may only contain lines for its own destination`,
        );
      }
    }

    const oldLineIds = new Set(carton.lines.map((l) => l.saleOrderLineId));
    const newLineIds = new Set(input.lines.map((l) => l.saleOrderLineId));
    const affectedLineIds = new Set([...oldLineIds, ...newLineIds]);

    const packedElsewhere = await getPhysicalPackedQuantitiesForLines(tx, [...affectedLineIds]);
    const thisCartonOldQty = new Map(carton.lines.map((l) => [l.saleOrderLineId, l.quantity]));
    for (const entry of input.lines) {
      const line = linesById.get(entry.saleOrderLineId)!;
      const totalIncludingOthers =
        (packedElsewhere.get(entry.saleOrderLineId) ?? 0) - (thisCartonOldQty.get(entry.saleOrderLineId) ?? 0) + entry.quantity;
      if (totalIncludingOthers > line.quantity) {
        throw HttpError.conflict(
          `Carton quantity for line ${entry.saleOrderLineId} would exceed its Dispatch Order quantity (${line.quantity})`,
        );
      }
    }

    const oldWeight = carton.weight?.toString() ?? null;
    const newWeight = input.weight != null ? input.weight.toString() : null;
    const oldPackageDetails = carton.packageDetails ?? null;
    const newPackageDetails = input.packageDetails ?? null;
    const destinationChanged = carton.destinationId !== input.destinationId;
    const packageDetailsChanged = oldPackageDetails !== newPackageDetails;
    const weightChanged = oldWeight !== newWeight;
    const oldLineKey = normalizedLineKey(carton.lines.map((l) => ({ saleOrderLineId: l.saleOrderLineId, quantity: l.quantity })));
    const newLineKey = normalizedLineKey(input.lines);
    const contentChanged = oldLineKey !== newLineKey;

    if (!destinationChanged && !packageDetailsChanged && !weightChanged && !contentChanged) {
      // No-op/retry: leave version, audit, and content untouched.
      return;
    }

    await tx.factoryPackingCartonLine.deleteMany({ where: { cartonId } });
    await tx.factoryPackingCarton.update({
      where: { id: cartonId },
      data: {
        destinationId: input.destinationId,
        packageDetails: newPackageDetails,
        weight: input.weight ?? null,
        version: { increment: 1 },
        lines: { create: input.lines.map((l) => ({ id: createId(), saleOrderLineId: l.saleOrderLineId, quantity: l.quantity })) },
      },
    });

    for (const lineId of affectedLineIds) {
      await reconcileFactoryDispatchLineAttribution(tx, factoryDispatchId, lineId);
    }

    await recordAuditLog(
      {
        actorId: actor.id,
        action: contentChanged ? 'CARTON_CONTENT_CHANGED' : 'CARTON_UPDATED',
        entityType: 'FactoryPackingCarton',
        entityId: cartonId,
        metadata: {
          factoryDispatchId,
          cartonNumber: carton.cartonNumber,
          destinationChanged,
          packageDetailsChanged,
          weightChanged,
          contentChanged,
        },
      },
      tx,
    );
  });

  return getFactoryDispatchDetail(actor, factoryDispatchId);
}

// Removal policy (Phase 4 plan §4): a carton with NO audit history at all is
// hard-deleted; a carton that was EVER audited (current or stale) becomes an
// immutable historical record instead — retired, excluded from physical
// totals/finalize/print, but its audit history remains queryable.
export async function removeFactoryPackingCarton(
  actor: CurrentUser,
  factoryDispatchId: string,
  cartonId: string,
  input: { expectedVersion: number },
) {
  assertMutationAccess(actor);

  await prisma.$transaction(async (tx) => {
    const pre = await tx.factoryDispatch.findUnique({ where: { id: factoryDispatchId }, select: { saleOrderId: true } });
    if (!pre) throw HttpError.notFound('Factory dispatch not found');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sale-order-${pre.saleOrderId}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`factory-dispatch-${factoryDispatchId}`}))`;

    const dispatch = await tx.factoryDispatch.findUnique({ where: { id: factoryDispatchId } });
    if (!dispatch) throw HttpError.notFound('Factory dispatch not found');
    if (dispatch.status !== 'DRAFT') throw HttpError.badRequest('Cartons can only be edited on a DRAFT Factory Dispatch');
    assertFactoryRowAccess(actor, dispatch.factoryId);

    const carton = await tx.factoryPackingCarton.findUnique({
      where: { id: cartonId },
      include: { lines: true, audits: { select: { id: true } } },
    });
    if (!carton || carton.factoryDispatchId !== factoryDispatchId) throw HttpError.notFound('Carton not found');
    if (carton.retiredAt) throw HttpError.badRequest('This carton has already been retired');
    if (carton.version !== input.expectedVersion) throw HttpError.staleVersion(carton.version);

    const affectedLineIds = carton.lines.map((l) => l.saleOrderLineId);
    const everAudited = carton.audits.length > 0;

    if (everAudited) {
      await tx.factoryPackingCarton.update({
        where: { id: cartonId },
        data: { retiredAt: new Date(), retiredById: actor.id },
      });
    } else {
      await tx.factoryPackingCartonLine.deleteMany({ where: { cartonId } });
      await tx.factoryPackingCarton.delete({ where: { id: cartonId } });
    }

    for (const lineId of affectedLineIds) {
      await reconcileFactoryDispatchLineAttribution(tx, factoryDispatchId, lineId);
    }

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'CARTON_REMOVED',
        entityType: 'FactoryPackingCarton',
        entityId: cartonId,
        metadata: { factoryDispatchId, cartonNumber: carton.cartonNumber, kind: everAudited ? 'RETIRED' : 'HARD_DELETED' },
      },
      tx,
    );
  });

  return getFactoryDispatchDetail(actor, factoryDispatchId);
}

// ---------------------------------------------------------------------------
// Packing Audit — lightweight carton inspection sign-off (Phase 4 plan
// §25-30). QA_USER only; idempotent at the carton's current version.
// ---------------------------------------------------------------------------

export async function confirmCartonPackingAudit(
  actor: CurrentUser,
  factoryDispatchId: string,
  cartonId: string,
  input: { remarks?: string | null },
) {
  assertPackingAuditMutationAccess(actor);

  await prisma.$transaction(async (tx) => {
    const dispatch = await tx.factoryDispatch.findUnique({ where: { id: factoryDispatchId }, select: { saleOrderId: true, status: true } });
    if (!dispatch) throw HttpError.notFound('Factory dispatch not found');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sale-order-${dispatch.saleOrderId}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`factory-dispatch-${factoryDispatchId}`}))`;

    const carton = await tx.factoryPackingCarton.findUnique({
      where: { id: cartonId },
      include: { lines: { include: { saleOrderLine: { select: { quantity: true, destinationId: true } } } } },
    });
    if (!carton || carton.factoryDispatchId !== factoryDispatchId) throw HttpError.notFound('Carton not found');
    if (carton.retiredAt) throw HttpError.badRequest('A retired carton cannot be inspected');
    if (carton.lines.length === 0) throw HttpError.badRequest('An empty carton cannot be inspected');
    const mismatch = carton.lines.some((l) => l.saleOrderLine.destinationId !== carton.destinationId);
    if (mismatch) {
      throw HttpError.badRequest('This carton contains a line for another destination and must be reconciled before inspection');
    }

    const existing = await tx.factoryPackingCartonAudit.findUnique({
      where: { cartonId_cartonVersion: { cartonId, cartonVersion: carton.version } },
    });
    if (existing) return; // idempotent: already current, no duplicate

    await tx.factoryPackingCartonAudit.create({
      data: {
        id: createId(),
        cartonId,
        cartonVersion: carton.version,
        inspectedById: actor.id,
        remarks: input.remarks ?? null,
      },
    });

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'CARTON_PACKING_AUDIT_CONFIRMED',
        entityType: 'FactoryPackingCarton',
        entityId: cartonId,
        metadata: { factoryDispatchId, cartonNumber: carton.cartonNumber, cartonVersion: carton.version },
      },
      tx,
    );
  });

  // Not getFactoryDispatchDetail: that enforces FACTORY_DISPATCH_VIEW_ROLES,
  // which deliberately excludes QA_USER (the only role that reaches this
  // point). Return the same QA-appropriate shape the discovery surface
  // uses instead, so the write and its own response share one access rule.
  return getPackingAuditCartonDetail(actor, cartonId);
}

// ---------------------------------------------------------------------------
// Packing Audit queue — QA's narrow, cross-factory discovery surface
// (Phase 4 plan §6). No StockAllocation/QaReleaseLine/Job Order fields.
// ---------------------------------------------------------------------------

// Phase 5: Distributor/Destination context for the Packing Audit PDF. Reads
// packingListCartonInclude's own destination relation (widened above) so the
// two Packing-Audit call sites below share one shape and can't drift.
function toPackingAuditDestinationView(carton: CartonRecord) {
  return {
    id: carton.destination.id,
    label: carton.destination.label,
    city: carton.destination.city,
    state: carton.destination.state,
    distributor: carton.destination.saleOrderDistributor.distributor,
  };
}

export async function getPackingAuditQueue(actor: CurrentUser, filters: { factoryId?: string; cursor?: string; limit: number }) {
  assertPackingAuditViewAccess(actor);

  const where: Prisma.FactoryPackingCartonWhereInput = {
    retiredAt: null,
    factoryDispatch: { status: 'DRAFT', factoryId: filters.factoryId },
  };

  const cartons = await prisma.factoryPackingCarton.findMany({
    where,
    include: {
      ...packingListCartonInclude,
      factoryDispatch: {
        select: {
          factoryDispatchNumber: true,
          factory: { select: { id: true, code: true, name: true } },
          saleOrder: { select: { id: true, saleOrderNumber: true } },
        },
      },
    },
    orderBy: { id: 'desc' },
    take: filters.limit + 1,
    cursor: filters.cursor ? { id: filters.cursor } : undefined,
    skip: filters.cursor ? 1 : undefined,
  });
  const hasMore = cartons.length > filters.limit;
  const page = hasMore ? cartons.slice(0, filters.limit) : cartons;

  return {
    items: page.map((carton) => ({
      ...toPackingListCartonView(carton),
      factoryDispatchNumber: carton.factoryDispatch.factoryDispatchNumber,
      factory: carton.factoryDispatch.factory,
      saleOrder: carton.factoryDispatch.saleOrder,
      destination: toPackingAuditDestinationView(carton),
    })),
    pageInfo: { limit: filters.limit, hasMore, nextCursor: hasMore ? page.at(-1)!.id : null },
  };
}

export async function getPackingAuditCartonDetail(actor: CurrentUser, cartonId: string) {
  assertPackingAuditViewAccess(actor);
  const carton = await prisma.factoryPackingCarton.findUnique({
    where: { id: cartonId },
    include: {
      ...packingListCartonInclude,
      factoryDispatch: {
        select: {
          id: true,
          factoryDispatchNumber: true,
          factory: { select: { id: true, code: true, name: true } },
          saleOrder: { select: { id: true, saleOrderNumber: true } },
        },
      },
    },
  });
  if (!carton) throw HttpError.notFound('Carton not found');
  return {
    ...toPackingListCartonView(carton),
    factoryDispatchId: carton.factoryDispatch.id,
    factoryDispatchNumber: carton.factoryDispatch.factoryDispatchNumber,
    factory: carton.factoryDispatch.factory,
    saleOrder: carton.factoryDispatch.saleOrder,
    destination: toPackingAuditDestinationView(carton),
  };
}

// ---------------------------------------------------------------------------
// Lifecycle — finalize (DRAFT -> READY_FOR_ERVE): the authoritative "goods
// left the factory for Erve" fact that locks the Dispatch Order. Coordinates
// on the SAME sale-order-{id} advisory lock updateDispatchOrder/carton
// mutations use, in the same outermost position. Evaluated only over
// non-retired cartons — retired cartons are immutable historical records
// and never block finalize. Errors are collected into one structured
// response (never a StockAllocation/QaReleaseLine/JobOrder id) rather than
// first-failure-wins.
// ---------------------------------------------------------------------------

export interface FinalizeIssueLine {
  saleOrderLineId: string;
  styleNumber: string;
  styleName: string;
  sizeCode: string;
  sizeLabel: string;
  required: number;
  packed: number;
}

export interface FinalizeIssueCarton {
  cartonId: string;
  cartonNumber: string;
  destinationId: string;
}

export interface FinalizeBlockers {
  cartonsNotAudited: FinalizeIssueCarton[];
  cartonsNeedingReinspection: FinalizeIssueCarton[];
  emptyCartons: FinalizeIssueCarton[];
  destinationMismatchCartons: FinalizeIssueCarton[];
  underPackedLines: FinalizeIssueLine[];
  overPackedLines: FinalizeIssueLine[];
  internalPackingMismatch: FinalizeIssueLine[];
}

export async function finalizeFactoryDispatch(actor: CurrentUser, id: string, input: { expectedVersion: number }) {
  assertMutationAccess(actor);

  await prisma.$transaction(async (tx) => {
    const pre = await tx.factoryDispatch.findUnique({ where: { id }, select: { saleOrderId: true } });
    if (!pre) throw HttpError.notFound('Factory dispatch not found');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sale-order-${pre.saleOrderId}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`factory-dispatch-${id}`}))`;

    const dispatch = await tx.factoryDispatch.findUnique({ where: { id } });
    if (!dispatch) throw HttpError.notFound('Factory dispatch not found');
    if (dispatch.version !== input.expectedVersion) throw HttpError.staleVersion(dispatch.version);
    if (dispatch.status !== 'DRAFT') throw HttpError.badRequest('Only a DRAFT Factory Dispatch can be finalized');
    assertFactoryRowAccess(actor, dispatch.factoryId);

    const saleOrderLines = await tx.saleOrderLine.findMany({
      where: { saleOrderId: pre.saleOrderId },
      include: {
        style: { select: { styleNumber: true, styleName: true } },
        size: { select: { code: true, label: true } },
      },
    });
    if (saleOrderLines.length === 0) throw HttpError.badRequest('A Factory Dispatch must have at least one line');

    const cartons = await tx.factoryPackingCarton.findMany({
      where: { factoryDispatchId: id },
      include: {
        lines: { include: { saleOrderLine: { select: { destinationId: true } } } },
        audits: { select: { cartonVersion: true } },
      },
    });
    const activeCartons = cartons.filter((c) => c.retiredAt === null);

    const physicalPackedByLine = await getPhysicalPackedQuantitiesForLines(
      tx,
      saleOrderLines.map((l) => l.id),
    );
    const factoryDispatchLineRows = await tx.factoryDispatchLine.groupBy({
      by: ['saleOrderLineId'],
      where: { saleOrderLineId: { in: saleOrderLines.map((l) => l.id) } },
      _sum: { packedQuantity: true },
    });
    const attributedByLine = new Map(factoryDispatchLineRows.map((r) => [r.saleOrderLineId, r._sum.packedQuantity ?? 0]));

    const blockers: FinalizeBlockers = {
      cartonsNotAudited: [],
      cartonsNeedingReinspection: [],
      emptyCartons: [],
      destinationMismatchCartons: [],
      underPackedLines: [],
      overPackedLines: [],
      internalPackingMismatch: [],
    };

    for (const carton of activeCartons) {
      const cartonRef = { cartonId: carton.id, cartonNumber: carton.cartonNumber, destinationId: carton.destinationId };
      if (carton.lines.length === 0) {
        blockers.emptyCartons.push(cartonRef);
        continue;
      }
      const mismatch = carton.lines.some((l) => l.saleOrderLine.destinationId !== carton.destinationId);
      if (mismatch) blockers.destinationMismatchCartons.push(cartonRef);

      const currentAudit = carton.audits.find((a) => a.cartonVersion === carton.version);
      if (!currentAudit) {
        if (carton.audits.length > 0) blockers.cartonsNeedingReinspection.push(cartonRef);
        else blockers.cartonsNotAudited.push(cartonRef);
      }
    }

    for (const line of saleOrderLines) {
      const lineRef: FinalizeIssueLine = {
        saleOrderLineId: line.id,
        styleNumber: line.style.styleNumber,
        styleName: line.style.styleName,
        sizeCode: line.size.code,
        sizeLabel: line.size.label,
        required: line.quantity,
        packed: physicalPackedByLine.get(line.id) ?? 0,
      };
      if (lineRef.packed < lineRef.required) blockers.underPackedLines.push(lineRef);
      if (lineRef.packed > lineRef.required) blockers.overPackedLines.push(lineRef);
      const attributed = attributedByLine.get(line.id) ?? 0;
      if (attributed !== lineRef.packed) blockers.internalPackingMismatch.push(lineRef);
    }

    const hasBlockers = Object.values(blockers).some((list) => list.length > 0);
    if (hasBlockers) {
      throw HttpError.badRequest('Cannot finalize: Factory Dispatch has outstanding packing/audit issues', blockers);
    }

    const updated = await tx.factoryDispatch.updateMany({
      where: { id, version: input.expectedVersion },
      data: { status: 'READY_FOR_ERVE', finalizedById: actor.id, finalizedAt: new Date(), version: { increment: 1 } },
    });
    if (updated.count !== 1) throw HttpError.staleVersion(dispatch.version);

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'FACTORY_DISPATCH_FINALIZED',
        entityType: 'FactoryDispatch',
        entityId: id,
        metadata: { factoryDispatchNumber: dispatch.factoryDispatchNumber },
      },
      tx,
    );

    // Factory Invoice generation is a data-integrity prerequisite of this
    // same atomic finalization, not a second independent workflow (see
    // factory-invoice.service.ts's module doc comment) — a missing
    // Style<->Factory rate fails this entire transaction, leaving the
    // dispatch DRAFT, rather than completing without the required invoice.
    await generateFactoryInvoiceForFinalizedDispatch(
      tx,
      actor,
      { id, factoryId: dispatch.factoryId, factoryDispatchNumber: dispatch.factoryDispatchNumber },
      saleOrderLines,
      physicalPackedByLine,
    );
  });

  return getFactoryDispatchDetail(actor, id);
}
