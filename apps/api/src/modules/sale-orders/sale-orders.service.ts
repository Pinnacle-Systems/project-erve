import { createId } from '@erve/shared';
import { createHash } from 'node:crypto';
import { Prisma, prisma } from '../../db/prisma.js';
import type { DistributorStatus, FactoryStatus, PurchaseMode } from '../../db/prisma.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import { getSoleFactoryId, requireFactoryAccess } from '../../auth/access.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { ensureFinancialYear } from '../master-data/financial-year.service.js';
import { allocateDocumentSerial } from '../master-data/document-sequence.service.js';
import { DOCUMENT_PREFIXES, formatDocumentNumber } from '../master-data/document-number.util.js';
import { getAvailableQuantities, getEligibleQaReleaseLinesForPool } from '../job-orders/pooled-inventory.service.js';
import { computeDispatchOrderFulfillment } from '../fulfillment/fulfillment-progress.js';
import { buildPackingListProjection, hardDeleteFactoryDispatches } from '../fulfillment/factory-dispatch.service.js';
import { getPhysicalPackedQuantitiesForLines } from '../fulfillment/packing-reconciliation.js';

type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Dispatch Order number generation (technical prefix/sequence unchanged —
// no new prefix was invented for the user-facing rename, per the Phase 3
// plan).
// ---------------------------------------------------------------------------

async function generateSaleOrderNumber(
  client: Tx,
  financialYear: { id: string; code: string },
): Promise<{ saleOrderNumber: string; saleOrderSerial: number }> {
  const saleOrderSerial = await allocateDocumentSerial(client, 'SALE_ORDER', financialYear.id);
  return {
    saleOrderNumber: formatDocumentNumber(DOCUMENT_PREFIXES.SALE_ORDER, financialYear.code, saleOrderSerial),
    saleOrderSerial,
  };
}

// ---------------------------------------------------------------------------
// Include / view helpers
// ---------------------------------------------------------------------------

const soInclude = {
  factory: { select: { id: true, code: true, name: true } },
  creator: { select: { id: true, name: true, email: true } },
  financialYear: { select: { id: true, code: true } },
  distributorGroups: {
    include: {
      distributor: { select: { id: true, code: true, name: true } },
      destinations: { orderBy: { createdAt: 'asc' as const } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  lines: {
    include: {
      style: { select: { id: true, styleNumber: true, styleName: true } },
      size: { select: { id: true, code: true, label: true, sortOrder: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.SaleOrderInclude;

type SORecord = Prisma.SaleOrderGetPayload<{ include: typeof soInclude }>;
type SOLineRecord = SORecord['lines'][number];
type SOGroupRecord = SORecord['distributorGroups'][number];
type SODestinationRecord = SOGroupRecord['destinations'][number];

// Distributor.purchaseMode is immutable after creation, so this snapshot
// (taken when the Distributor is attached to the Dispatch Order) can never
// diverge from the master — see the "Distributor identity snapshot scope"
// section of the Correction 8 plan. name/code/GSTIN are deliberately NOT
// snapshotted (live-joined via `distributor` instead), matching the only
// other snapshot precedent in this codebase
// (DistributorPurchaseOrder.purchaseMode).
function toDestinationView(destination: SODestinationRecord, canMoveDistributor: boolean) {
  return {
    id: destination.id,
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
    canMoveDistributor,
  };
}

function toLineView(line: SOLineRecord) {
  return {
    id: line.id,
    destinationId: line.destinationId,
    styleId: line.styleId,
    styleNumber: line.style.styleNumber,
    styleName: line.style.styleName,
    sizeId: line.sizeId,
    sizeCode: line.size.code,
    sizeLabel: line.size.label,
    quantity: line.quantity,
    remarks: line.remarks,
  };
}

// The single shared eligibility predicate for "may this destination's
// Distributor-group be changed right now" — used identically by the read
// projection below and by the updateDispatchOrder move guard, so the two
// can never drift apart (Correction 8 review point). A destination is
// movable only while the whole Dispatch Order is still editable AND it has
// zero (non-retired) cartons — see the Correction 8 plan's safety-boundary
// verification: no Distributor-sensitive downstream record (FactoryInvoice,
// EIPL, ErveDispatch, InvoiceHandoff, delivery/sales/return lines) can exist
// for a destination before its first carton does, so "zero cartons" is the
// exact and earliest safe boundary.
async function getCartonCountByDestination(client: Tx | typeof prisma, destinationIds: string[]): Promise<Map<string, number>> {
  if (destinationIds.length === 0) return new Map();
  const rows = await client.factoryPackingCarton.groupBy({
    by: ['destinationId'],
    where: { destinationId: { in: destinationIds }, retiredAt: null },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.destinationId, r._count._all]));
}

async function computeCanMoveDistributor(
  client: Tx | typeof prisma,
  saleOrderId: string,
  destinationIds: string[],
): Promise<Map<string, boolean>> {
  const [locked, cartonCounts] = await Promise.all([
    isDispatchOrderLocked(client, saleOrderId),
    getCartonCountByDestination(client, destinationIds),
  ]);
  const result = new Map<string, boolean>();
  for (const id of destinationIds) {
    result.set(id, !locked && (cartonCounts.get(id) ?? 0) === 0);
  }
  return result;
}

async function toSaleOrderView(order: SORecord) {
  const isLocked = await isDispatchOrderLocked(prisma, order.id);
  const fulfillment = await computeDispatchOrderFulfillment(
    prisma,
    order.id,
    order.lines.map((line) => ({ quantity: line.quantity })),
  );

  const allDestinationIds = order.distributorGroups.flatMap((g) => g.destinations.map((d) => d.id));
  const canMoveByDestinationId = await computeCanMoveDistributor(prisma, order.id, allDestinationIds);
  const canMove = (destinationId: string) => canMoveByDestinationId.get(destinationId) ?? false;

  const lines = order.lines.map(toLineView);
  const linesByDestinationId = new Map<string, ReturnType<typeof toLineView>[]>();
  for (const line of lines) {
    const list = linesByDestinationId.get(line.destinationId) ?? [];
    list.push(line);
    linesByDestinationId.set(line.destinationId, list);
  }

  const distributorGroups = order.distributorGroups.map((group) => ({
    id: group.id,
    distributor: { id: group.distributor.id, code: group.distributor.code, name: group.distributor.name },
    purchaseMode: group.purchaseMode,
    destinations: group.destinations.map((d) => toDestinationView(d, canMove(d.id))),
    lines: group.destinations.flatMap((d) => linesByDestinationId.get(d.id) ?? []),
  }));

  const distributors = order.distributorGroups.map((g) => ({
    id: g.distributor.id,
    code: g.distributor.code,
    name: g.distributor.name,
    purchaseMode: g.purchaseMode,
  }));

  return {
    id: order.id,
    saleOrderNumber: order.saleOrderNumber,
    distributors,
    factory: order.factory,
    financialYear: order.financialYear,
    soDate: order.soDate.toISOString(),
    status: order.status,
    destinationCount: allDestinationIds.length,
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    createdAt: order.createdAt.toISOString(),
    isLocked,
    creator: order.creator,
    remarks: order.remarks,
    distributorGroups,
    lines,
    fulfillment,
    version: order.version,
    updatedAt: order.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Access helpers
// ---------------------------------------------------------------------------

// MERCHANDISER creates/edits; ADMIN preserves the operational mutation
// rights it already had under the old Sale Order workflow (no new
// capability granted here). No DISTRIBUTOR role at all.
function assertDispatchOrderMutationAccess(user: CurrentUser): void {
  if (!user.roles.some((r) => r === 'ADMIN' || r === 'MERCHANDISER')) {
    throw HttpError.forbidden('You do not have permission to manage dispatch orders');
  }
}

// ADMIN/MERCHANDISER/SENIOR_MANAGEMENT/ACCOUNTANT see every Dispatch Order
// (read-only for the latter two); FACTORY_USER is scoped to their own
// mapped factory only (see resolveListFactoryScope/assertDispatchOrderViewAccess).
// DISTRIBUTOR and QA_USER have no Dispatch Order access at all — enforced
// primarily by the route role guards, these helpers are defense in depth.
function canViewAllDispatchOrders(user: CurrentUser): boolean {
  return user.roles.some((r) => r === 'ADMIN' || r === 'MERCHANDISER' || r === 'SENIOR_MANAGEMENT' || r === 'ACCOUNTANT');
}

function resolveListFactoryScope(user: CurrentUser, requestedFactoryId?: string): string | undefined {
  if (canViewAllDispatchOrders(user)) return requestedFactoryId;
  if (user.roles.includes('FACTORY_USER')) return getSoleFactoryId(user);
  throw HttpError.forbidden('You do not have permission to view dispatch orders');
}

function assertDispatchOrderViewAccess(user: CurrentUser, order: { factoryId: string }): void {
  if (canViewAllDispatchOrders(user)) return;
  if (user.roles.includes('FACTORY_USER')) {
    requireFactoryAccess(user, order.factoryId);
    return;
  }
  throw HttpError.forbidden('You do not have access to this dispatch order');
}

// Audit history carries internal allocation-adjacent metadata that must
// never reach FACTORY_USER (see the audit-sanitization correction) — the
// route excludes FACTORY_USER from this endpoint entirely; this is the
// service-side backstop.
function assertDispatchOrderAuditAccess(user: CurrentUser): void {
  if (!canViewAllDispatchOrders(user)) {
    throw HttpError.forbidden('You do not have permission to view dispatch order audit history');
  }
}

// The authoritative "goods have left the factory for Erve" fact — a
// FactoryDispatch reaching READY_FOR_ERVE, or any ErveDispatch existing.
// No role, including ADMIN, may bypass this once true.
async function isDispatchOrderLocked(client: Tx | typeof prisma, saleOrderId: string): Promise<boolean> {
  const [readyFactoryDispatch, anyErveDispatch] = await Promise.all([
    client.factoryDispatch.count({ where: { saleOrderId, status: 'READY_FOR_ERVE' } }),
    client.erveDispatch.count({ where: { saleOrderId } }),
  ]);
  return readyFactoryDispatch > 0 || anyErveDispatch > 0;
}

// ---------------------------------------------------------------------------
// Idempotency (mirrors JobOrderIdempotencyRecord's actorId:operation:key scheme)
// ---------------------------------------------------------------------------

function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

// Looks up a prior successful CREATE/UPDATE by (actorId, operation, key).
// Returns the saleOrderId it produced, or null if this is a fresh request.
// `expectedSaleOrderId` (update only) additionally asserts the replay
// targets the same order the key was first used against.
async function findIdempotentSaleOrderId(
  tx: Tx,
  actorId: string,
  operation: string,
  idempotencyKey: string,
  hash: string,
  expectedSaleOrderId?: string,
): Promise<string | null> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${actorId}:${operation}:${idempotencyKey}`}))`;
  const existing = await tx.saleOrderIdempotencyRecord.findUnique({
    where: { actorId_operation_idempotencyKey: { actorId, operation, idempotencyKey } },
  });
  if (!existing) return null;
  if (existing.requestHash !== hash) throw HttpError.idempotencyKeyReused();
  if (expectedSaleOrderId && existing.saleOrderId !== expectedSaleOrderId) throw HttpError.idempotencyKeyReused();
  return existing.saleOrderId;
}

async function recordIdempotentOperation(
  tx: Tx,
  actorId: string,
  saleOrderId: string,
  operation: string,
  idempotencyKey: string,
  hash: string,
  resultVersion: number,
): Promise<void> {
  await tx.saleOrderIdempotencyRecord.create({
    data: { id: createId(), actorId, saleOrderId, operation, idempotencyKey, requestHash: hash, resultVersion },
  });
}

// ---------------------------------------------------------------------------
// Shared deterministic allocation planner (used identically by create and
// update — see the Phase 3 plan's "one common deterministic allocation
// planner" requirement). Demand lines are sorted by destinationId then
// lineRef; candidates are walked in the order the caller provides them
// (oldest-QaRelease-first, id tiebreak — see getEligibleQaReleaseLinesForPool)
// and consumed monotonically, so a given (lineRef, qaReleaseLineId) pair is
// produced at most once per call. Correction 8: this pool is keyed only by
// Factory+Style+Size and has no awareness of Distributor/destination — it
// aggregates demand across every destination/Distributor in the order
// identically to before, so it needs no changes for multi-distributor
// support.
// ---------------------------------------------------------------------------

interface PoolDemandEntry {
  lineRef: string;
  destinationId: string;
  neededQuantity: number;
}

interface PlannedAllocation {
  lineRef: string;
  qaReleaseLineId: string;
  quantity: number;
}

function planPoolAllocation(
  demands: PoolDemandEntry[],
  candidates: Array<{ id: string; effectiveAvailable: number }>,
): { allocations: PlannedAllocation[]; shortfall: number } {
  const sortedDemands = [...demands].sort(
    (a, b) => a.destinationId.localeCompare(b.destinationId) || a.lineRef.localeCompare(b.lineRef),
  );
  const remaining = new Map(candidates.map((c) => [c.id, c.effectiveAvailable]));
  const order = candidates.map((c) => c.id);
  const allocations: PlannedAllocation[] = [];
  let cursor = 0;
  for (const demand of sortedDemands) {
    let need = demand.neededQuantity;
    while (need > 0 && cursor < order.length) {
      const candidateId = order[cursor]!;
      const avail = remaining.get(candidateId) ?? 0;
      if (avail <= 0) {
        cursor += 1;
        continue;
      }
      const consume = Math.min(avail, need);
      remaining.set(candidateId, avail - consume);
      need -= consume;
      allocations.push({ lineRef: demand.lineRef, qaReleaseLineId: candidateId, quantity: consume });
      if ((remaining.get(candidateId) ?? 0) <= 0) cursor += 1;
    }
    if (need > 0) return { allocations, shortfall: need };
  }
  return { allocations, shortfall: 0 };
}

async function reserveAcrossPools(
  tx: Tx,
  factoryId: string,
  demandByPoolKey: Map<string, PoolDemandEntry[]>,
  plannedReleaseByReleaseLine: Map<string, number>,
): Promise<PlannedAllocation[]> {
  const planned: PlannedAllocation[] = [];
  for (const [poolKey, demands] of demandByPoolKey) {
    const [styleId, sizeId] = poolKey.split(':') as [string, string];
    const candidates = await getEligibleQaReleaseLinesForPool(tx, factoryId, styleId, sizeId);
    const availability = await getAvailableQuantities(
      tx,
      candidates.map((c) => c.id),
    );
    const candidateAvailability = candidates.map((c) => ({
      id: c.id,
      effectiveAvailable: (availability.get(c.id)?.available ?? 0) + (plannedReleaseByReleaseLine.get(c.id) ?? 0),
    }));
    const { allocations, shortfall } = planPoolAllocation(demands, candidateAvailability);
    if (shortfall > 0) {
      // Resolve to human-readable Style/Size identifiers for the error
      // message — this is the exceptional (conflict) path only, so the
      // extra lookup here doesn't cost anything on the common success path.
      // Never surface the raw internal styleId/sizeId ULIDs to the user
      // (see the Dispatch Order Phase 3 rule against leaking internal
      // traceability ids into user-facing text).
      const [style, size] = await Promise.all([
        tx.style.findUnique({ where: { id: styleId }, select: { styleNumber: true, styleName: true } }),
        tx.size.findUnique({ where: { id: sizeId }, select: { label: true, code: true } }),
      ]);
      const styleLabel = style ? `${style.styleNumber} — ${style.styleName}` : styleId;
      const sizeLabel = size ? size.label || size.code : sizeId;
      throw HttpError.conflict(
        `Insufficient pooled stock for ${styleLabel} / ${sizeLabel} at the selected Factory: short by ${shortfall} unit(s)`,
      );
    }
    planned.push(...allocations);
  }
  return planned;
}

function poolKeyOf(styleId: string, sizeId: string): string {
  return `${styleId}:${sizeId}`;
}

async function lockPoolKeys(tx: Tx, factoryId: string, poolKeys: Iterable<string>): Promise<void> {
  for (const poolKey of [...new Set(poolKeys)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dispatch-pool-${factoryId}-${poolKey}`}))`;
  }
}

// ---------------------------------------------------------------------------
// Input validation (existence-only Style/Size checks — see the Phase 3
// plan §2.0: a Dispatch Order allocates physically existing QA-passed
// stock, so line validation never re-checks Style/Size/StyleSize active
// status, only that the ids resolve to real rows)
// ---------------------------------------------------------------------------

export interface DispatchOrderDestinationInput {
  clientKey: string;
  id?: string;
  label?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  country: string;
  postalCode?: string | null;
  gstin?: string | null;
}

export interface DispatchOrderDistributorGroupInput {
  clientKey: string;
  id?: string;
  distributorId: string;
  destinations: DispatchOrderDestinationInput[];
}

export interface DispatchOrderLineInput {
  id?: string;
  destinationClientKey: string;
  styleId: string;
  sizeId: string;
  quantity: number;
}

export interface CreateDispatchOrderInput {
  factoryId: string;
  soDate: string;
  remarks?: string | null;
  distributors: DispatchOrderDistributorGroupInput[];
  lines: DispatchOrderLineInput[];
}

export interface UpdateDispatchOrderInput {
  expectedVersion: number;
  factoryId?: string;
  soDate?: string;
  remarks?: string | null;
  distributors?: DispatchOrderDistributorGroupInput[];
  lines?: DispatchOrderLineInput[];
}

type FlattenedDestinationInput = DispatchOrderDestinationInput & { groupClientKey: string };

function validateDestinationClientKeys(destinations: DispatchOrderDestinationInput[]): void {
  if (destinations.length === 0) throw HttpError.badRequest('At least one destination is required');
  const keys = destinations.map((d) => d.clientKey);
  if (keys.some((k) => !k?.trim())) throw HttpError.badRequest('Every destination must have a non-empty clientKey');
  if (new Set(keys).size !== keys.length) throw HttpError.badRequest('Duplicate destination clientKey');
}

// Validates the Distributor-group level of the request and returns the
// flattened destination list (each tagged with its owning group's
// clientKey) for the existing destination/line machinery below. Two
// separate clientKey namespaces are enforced, each independently unique:
// group clientKeys among themselves, and destination clientKeys globally
// across every group (never per-group) — required because
// lines[].destinationClientKey resolves through one flat lookup map. A
// group clientKey happening to equal some destination's clientKey is
// harmless and not restricted; the two are never looked up through the
// same map.
function validateDistributorGroups(distributors: DispatchOrderDistributorGroupInput[]): FlattenedDestinationInput[] {
  if (distributors.length === 0) throw HttpError.badRequest('At least one Distributor is required');
  const groupClientKeys = distributors.map((g) => g.clientKey);
  if (groupClientKeys.some((k) => !k?.trim())) {
    throw HttpError.badRequest('Every Distributor group must have a non-empty clientKey');
  }
  if (new Set(groupClientKeys).size !== groupClientKeys.length) {
    throw HttpError.badRequest('Duplicate Distributor group clientKey');
  }
  const distributorIds = distributors.map((g) => g.distributorId);
  if (new Set(distributorIds).size !== distributorIds.length) {
    throw HttpError.badRequest('Duplicate Distributor — each Distributor may appear only once per Dispatch Order');
  }
  for (const group of distributors) {
    if (group.destinations.length === 0) {
      throw HttpError.badRequest(`Distributor group ${group.clientKey} has no destinations`);
    }
  }
  const flattened = distributors.flatMap((g) => g.destinations.map((d) => ({ ...d, groupClientKey: g.clientKey })));
  validateDestinationClientKeys(flattened);
  return flattened;
}

function validateLinesShape(destinations: DispatchOrderDestinationInput[], lines: DispatchOrderLineInput[]): void {
  if (lines.length === 0) throw HttpError.badRequest('At least one quantity line is required');
  const clientKeySet = new Set(destinations.map((d) => d.clientKey));
  const usedDestinations = new Set<string>();
  const dedupeKeys = new Set<string>();
  for (const line of lines) {
    if (!clientKeySet.has(line.destinationClientKey)) {
      throw HttpError.badRequest(`Line references unknown destination clientKey ${line.destinationClientKey}`);
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw HttpError.badRequest('Line quantity must be a positive integer');
    }
    usedDestinations.add(line.destinationClientKey);
    const key = `${line.destinationClientKey}:${line.styleId}:${line.sizeId}`;
    if (dedupeKeys.has(key)) throw HttpError.badRequest('Duplicate destination/style/size line in the same request');
    dedupeKeys.add(key);
  }
  for (const clientKey of clientKeySet) {
    if (!usedDestinations.has(clientKey)) throw HttpError.badRequest(`Destination ${clientKey} has no quantity lines`);
  }
}

async function assertStylesAndSizesExist(styleIds: string[], sizeIds: string[]): Promise<void> {
  const [styles, sizes] = await Promise.all([
    prisma.style.findMany({ where: { id: { in: styleIds } }, select: { id: true } }),
    prisma.size.findMany({ where: { id: { in: sizeIds } }, select: { id: true } }),
  ]);
  const styleIdSet = new Set(styles.map((s) => s.id));
  const sizeIdSet = new Set(sizes.map((s) => s.id));
  for (const styleId of styleIds) if (!styleIdSet.has(styleId)) throw HttpError.badRequest(`Style ${styleId} not found`);
  for (const sizeId of sizeIds) if (!sizeIdSet.has(sizeId)) throw HttpError.badRequest(`Size ${sizeId} not found`);
}

interface DistributorRow {
  id: string;
  code: string;
  name: string;
  status: string;
  purchaseMode: PurchaseMode;
}

async function loadAndValidateDistributors(distributorIds: string[]): Promise<Map<string, DistributorRow>> {
  const distributors = await prisma.distributor.findMany({ where: { id: { in: distributorIds } } });
  const distributorById = new Map(distributors.map((d) => [d.id, d]));
  for (const distributorId of distributorIds) {
    const distributor = distributorById.get(distributorId);
    if (!distributor) throw HttpError.badRequest(`Distributor ${distributorId} not found`);
    if (distributor.status !== 'ACTIVE') throw HttpError.badRequest(`Distributor ${distributor.name} is not active`);
  }
  return distributorById;
}

// ---------------------------------------------------------------------------
// Service methods — reads
// ---------------------------------------------------------------------------

export async function getSaleOrderList(
  user: CurrentUser,
  filters: { search?: string; distributorId?: string; factoryId?: string; financialYearId?: string; cursor?: string; limit: number },
) {
  const factoryIdFilter = resolveListFactoryScope(user, filters.factoryId);

  // "Show Dispatch Orders containing this Distributor" (Correction 8) — a
  // relation `some` filter is a plain EXISTS subquery, so this composes
  // fine alongside cursor/skip/take without breaking pagination.
  const where: Prisma.SaleOrderWhereInput = {
    distributorGroups: filters.distributorId ? { some: { distributorId: filters.distributorId } } : undefined,
    factoryId: factoryIdFilter,
    financialYearId: filters.financialYearId,
    OR: filters.search ? [{ saleOrderNumber: { contains: filters.search, mode: 'insensitive' } }] : undefined,
  };

  const orders = await prisma.saleOrder.findMany({
    where,
    include: soInclude,
    orderBy: { id: 'desc' },
    take: filters.limit + 1,
    cursor: filters.cursor ? { id: filters.cursor } : undefined,
    skip: filters.cursor ? 1 : undefined,
  });
  const hasMore = orders.length > filters.limit;
  const page = hasMore ? orders.slice(0, filters.limit) : orders;
  return {
    items: await Promise.all(page.map((order) => toSaleOrderView(order))),
    pageInfo: { limit: filters.limit, hasMore, nextCursor: hasMore ? page.at(-1)!.id : null },
  };
}

// UXAUTH-015: the minimal fields the Dispatch Order Factory/Distributor
// filters need, gated by DISPATCH_ORDER_FILTER_ROLES rather than the broad
// Factory/Distributor master view permissions — see sale-orders.routes.ts.
// No status filter is applied unless the caller passes one: Dispatch Order
// list is historical, so a Factory/Distributor that has since gone INACTIVE
// must remain selectable to keep filtering its past Dispatch Orders, not
// just visible in the unfiltered table.
export async function listFactoryOptionsForDispatchOrders(filters: { status?: FactoryStatus }) {
  return prisma.factory.findMany({
    where: { status: filters.status },
    orderBy: { name: 'asc' },
    select: { id: true, code: true, name: true, status: true },
  });
}

// With `limit` (the Dispatch Order Distributor filter lookup, P1L8) this is a
// bounded search on code or name; without it, the complete option set.
export async function listDistributorOptionsForDispatchOrders(filters: {
  status?: DistributorStatus;
  search?: string;
  limit?: number;
}) {
  const search = filters.search || undefined;
  return prisma.distributor.findMany({
    where: {
      status: filters.status,
      OR: search
        ? [
            { code: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } },
          ]
        : undefined,
    },
    // id breaks name ties so a bounded page is deterministic.
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: { id: true, code: true, name: true, status: true },
    take: filters.limit,
  });
}

export async function getSaleOrderDetail(user: CurrentUser, id: string) {
  const order = await prisma.saleOrder.findUnique({ where: { id }, include: soInclude });
  if (!order) throw HttpError.notFound('Dispatch order not found');
  assertDispatchOrderViewAccess(user, order);
  return toSaleOrderView(order);
}

// Phase 4: the Factory Packing List is readable the moment a Dispatch Order
// exists — no FactoryDispatch id required, and this creates nothing. Reuses
// the SAME server-side access rule as GET /sale-orders/:id
// (assertDispatchOrderViewAccess) rather than inventing a separate one, so a
// Factory-F2-mapped FACTORY_USER requesting Factory F1's packing-list URL is
// rejected exactly like it would be for the Dispatch Order itself — before
// any FactoryDispatch root exists to check against. QA_USER is deliberately
// NOT granted this endpoint; its Packing Audit discovery path is the narrow
// /packing-audit/... surface instead.
export async function getDispatchOrderPackingList(user: CurrentUser, id: string) {
  const order = await prisma.saleOrder.findUnique({ where: { id }, select: { id: true, factoryId: true } });
  if (!order) throw HttpError.notFound('Dispatch order not found');
  assertDispatchOrderViewAccess(user, order);
  return buildPackingListProjection(order);
}

const DISPATCH_ORDER_AUDIT_TITLES: Record<string, string> = {
  DISPATCH_ORDER_CREATED: 'Dispatch Order Created',
  DISPATCH_ORDER_UPDATED: 'Dispatch Order Corrected',
};

function sentenceCaseAction(action: string): string {
  const words = action.trim().replaceAll('_', ' ').toLowerCase().trim();
  return words ? `${words[0]!.toUpperCase()}${words.slice(1)}` : 'Unknown event';
}

function auditMetadataObject(metadata: unknown): Record<string, unknown> {
  return metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

interface DistributorAuditEntry {
  distributorId: string;
  code: string;
  purchaseMode: string;
}

interface DestinationMoveAuditEntry {
  destinationId: string;
  label: string | null;
  fromDistributorId: string;
  toDistributorId: string;
  fromPurchaseMode: string;
  toPurchaseMode: string;
}

function formatDistributorLabel(entry: { code: string; purchaseMode: string }): string {
  return `${entry.code} (${entry.purchaseMode})`;
}

export async function getSaleOrderAuditHistory(user: CurrentUser, id: string) {
  assertDispatchOrderAuditAccess(user);
  const order = await prisma.saleOrder.findUnique({ where: { id }, select: { id: true } });
  if (!order) throw HttpError.notFound('Dispatch order not found');

  const rows = await prisma.auditLog.findMany({
    where: { entityType: 'SaleOrder', entityId: id },
    select: {
      id: true,
      action: true,
      createdAt: true,
      metadata: true,
      actor: { select: { id: true, name: true, email: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  return rows.map((row) => {
    const metadata = auditMetadataObject(row.metadata);
    let detail: string | null;
    switch (row.action) {
      case 'DISPATCH_ORDER_CREATED': {
        const totalQuantity = typeof metadata.totalQuantity === 'number' ? metadata.totalQuantity : undefined;
        const lineCount = typeof metadata.lineCount === 'number' ? metadata.lineCount : undefined;
        const distributors = Array.isArray(metadata.distributors) ? (metadata.distributors as DistributorAuditEntry[]) : [];
        const distributorsPart =
          distributors.length > 0 ? `; distributors: ${distributors.map(formatDistributorLabel).join(', ')}` : '';
        detail =
          totalQuantity !== undefined && lineCount !== undefined
            ? `${totalQuantity} unit(s) reserved across ${lineCount} line(s)${distributorsPart}`
            : null;
        break;
      }
      case 'DISPATCH_ORDER_UPDATED': {
        const summary = typeof metadata.summary === 'string' ? metadata.summary : undefined;
        const added = Array.isArray(metadata.distributorsAdded) ? (metadata.distributorsAdded as DistributorAuditEntry[]) : [];
        const removed = Array.isArray(metadata.distributorsRemoved) ? (metadata.distributorsRemoved as DistributorAuditEntry[]) : [];
        const moved = Array.isArray(metadata.destinationsMoved) ? (metadata.destinationsMoved as DestinationMoveAuditEntry[]) : [];
        const parts: string[] = [];
        if (summary) parts.push(summary);
        for (const d of added) parts.push(`Distributor ${formatDistributorLabel(d)} added`);
        for (const d of removed) parts.push(`Distributor ${formatDistributorLabel(d)} removed`);
        for (const m of moved) {
          parts.push(
            `${m.label ?? m.destinationId} moved (${m.fromPurchaseMode} -> ${m.toPurchaseMode})`,
          );
        }
        detail = parts.length > 0 ? parts.join('; ') : null;
        break;
      }
      default:
        detail = null;
    }
    return {
      id: row.id,
      action: row.action,
      title: DISPATCH_ORDER_AUDIT_TITLES[row.action] ?? sentenceCaseAction(row.action),
      detail,
      actor: row.actor,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

// ---------------------------------------------------------------------------
// createDispatchOrder — creation is the sole allocation point
// ---------------------------------------------------------------------------

export async function createDispatchOrder(
  actor: CurrentUser,
  input: CreateDispatchOrderInput,
  idempotencyKey: string,
) {
  assertDispatchOrderMutationAccess(actor);
  if (input.lines.some((line) => line.id)) {
    throw HttpError.badRequest('Line ids may only be supplied when correcting an existing dispatch order');
  }
  for (const group of input.distributors) {
    if (group.id) throw HttpError.badRequest('Distributor group ids may only be supplied when correcting an existing dispatch order');
    if (group.destinations.some((d) => d.id)) {
      throw HttpError.badRequest('Destination ids may only be supplied when correcting an existing dispatch order');
    }
  }
  const flattenedDestinations = validateDistributorGroups(input.distributors);
  validateLinesShape(flattenedDestinations, input.lines);

  const distributorById = await loadAndValidateDistributors(input.distributors.map((g) => g.distributorId));
  const factory = await prisma.factory.findUnique({ where: { id: input.factoryId } });
  if (!factory) throw HttpError.badRequest('Factory not found');
  if (factory.status !== 'ACTIVE') throw HttpError.badRequest('Factory is not active');

  await assertStylesAndSizesExist(
    [...new Set(input.lines.map((l) => l.styleId))],
    [...new Set(input.lines.map((l) => l.sizeId))],
  );

  const soId = createId();
  const hash = requestHash(input);

  const resultId = await prisma.$transaction(async (tx) => {
    const existingId = await findIdempotentSaleOrderId(tx, actor.id, 'CREATE', idempotencyKey, hash);
    if (existingId) return existingId;

    const groupIdByClientKey = new Map(input.distributors.map((g) => [g.clientKey, createId()]));
    const destinationIdByClientKey = new Map(flattenedDestinations.map((d) => [d.clientKey, createId()]));
    const lineDefs = input.lines.map((line) => ({
      id: createId(),
      destinationId: destinationIdByClientKey.get(line.destinationClientKey)!,
      styleId: line.styleId,
      sizeId: line.sizeId,
      quantity: line.quantity,
    }));

    const demandByPoolKey = new Map<string, PoolDemandEntry[]>();
    for (const line of lineDefs) {
      const key = poolKeyOf(line.styleId, line.sizeId);
      const list = demandByPoolKey.get(key) ?? [];
      list.push({ lineRef: line.id, destinationId: line.destinationId, neededQuantity: line.quantity });
      demandByPoolKey.set(key, list);
    }

    await lockPoolKeys(tx, input.factoryId, demandByPoolKey.keys());
    const plannedAllocations = await reserveAcrossPools(tx, input.factoryId, demandByPoolKey, new Map());

    const financialYear = await ensureFinancialYear(tx, new Date(input.soDate));
    const { saleOrderNumber, saleOrderSerial } = await generateSaleOrderNumber(tx, financialYear);

    await tx.saleOrder.create({
      data: {
        id: soId,
        saleOrderNumber,
        factoryId: input.factoryId,
        createdBy: actor.id,
        soDate: new Date(input.soDate),
        remarks: input.remarks ?? null,
        financialYearId: financialYear.id,
        soSerial: saleOrderSerial,
      },
    });

    await tx.saleOrderDistributor.createMany({
      data: input.distributors.map((g) => ({
        id: groupIdByClientKey.get(g.clientKey)!,
        saleOrderId: soId,
        distributorId: g.distributorId,
        // Explicit application-generated id (createId(), a ULID) — distinct
        // from the one-time raw-SQL migration backfill, which necessarily
        // used gen_random_uuid()::text instead (no app code access there).
        purchaseMode: distributorById.get(g.distributorId)!.purchaseMode,
      })),
    });

    await tx.saleOrderDestination.createMany({
      data: flattenedDestinations.map((d) => ({
        id: destinationIdByClientKey.get(d.clientKey)!,
        saleOrderId: soId,
        saleOrderDistributorId: groupIdByClientKey.get(d.groupClientKey)!,
        label: d.label ?? null,
        contactName: d.contactName ?? null,
        contactEmail: d.contactEmail ?? null,
        contactPhone: d.contactPhone ?? null,
        addressLine1: d.addressLine1,
        addressLine2: d.addressLine2 ?? null,
        city: d.city,
        state: d.state,
        country: d.country,
        postalCode: d.postalCode ?? null,
        gstin: d.gstin ?? null,
      })),
    });

    await tx.saleOrderLine.createMany({
      data: lineDefs.map((line) => ({
        id: line.id,
        saleOrderId: soId,
        destinationId: line.destinationId,
        styleId: line.styleId,
        sizeId: line.sizeId,
        quantity: line.quantity,
      })),
    });

    for (const allocation of plannedAllocations) {
      await tx.stockAllocation.create({
        data: {
          id: createId(),
          saleOrderLineId: allocation.lineRef,
          qaReleaseLineId: allocation.qaReleaseLineId,
          quantity: allocation.quantity,
          status: 'ACTIVE',
          allocationSource: 'MERCHANDISER_ALLOCATION',
          allocatedById: actor.id,
        },
      });
    }

    const distributorAuditEntries: DistributorAuditEntry[] = input.distributors.map((g) => {
      const distributor = distributorById.get(g.distributorId)!;
      return { distributorId: g.distributorId, code: distributor.code, purchaseMode: distributor.purchaseMode };
    });

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'DISPATCH_ORDER_CREATED',
        entityType: 'SaleOrder',
        entityId: soId,
        metadata: {
          saleOrderNumber,
          distributors: distributorAuditEntries,
          factoryId: input.factoryId,
          destinationCount: flattenedDestinations.length,
          lineCount: lineDefs.length,
          totalQuantity: lineDefs.reduce((sum, l) => sum + l.quantity, 0),
        } as unknown as Prisma.InputJsonValue,
      },
      tx,
    );
    await recordIdempotentOperation(tx, actor.id, soId, 'CREATE', idempotencyKey, hash, 1);
    return soId;
  });

  return getSaleOrderDetail(actor, resultId);
}

// ---------------------------------------------------------------------------
// updateDispatchOrder — surgical line-level sync (see the Phase 3 plan §2.3),
// extended (Correction 8) with a Distributor-group reconciliation layer that
// sits above it: group add/remove composes naturally with the existing
// destination reconciliation (a dropped group's destinations simply stop
// appearing in the flattened input, so they become ordinary destination-
// delete-candidates already) — the only genuinely new pieces are (1)
// resolving each destination's saleOrderDistributorId, (2) detecting and
// guarding destination MOVES between groups, and (3) creating new groups
// first / deleting emptied groups last.
// ---------------------------------------------------------------------------

interface LoadedLine {
  id: string;
  destinationId: string;
  styleId: string;
  sizeId: string;
  quantity: number;
  allocations: Array<{ id: string; qaReleaseLineId: string; quantity: number }>;
}

interface LoadedDestination {
  id: string;
  saleOrderDistributorId: string;
}

interface LoadedGroup {
  id: string;
  distributorId: string;
  purchaseMode: PurchaseMode;
  code: string;
}

export async function updateDispatchOrder(
  actor: CurrentUser,
  id: string,
  input: UpdateDispatchOrderInput,
  idempotencyKey: string,
) {
  assertDispatchOrderMutationAccess(actor);

  const preCheck = await prisma.saleOrder.findUnique({ where: { id } });
  if (!preCheck) throw HttpError.notFound('Dispatch order not found');
  if (await isDispatchOrderLocked(prisma, id)) {
    throw HttpError.badRequest('This dispatch order is locked: Factory Dispatch has already occurred');
  }
  if (Boolean(input.distributors) !== Boolean(input.lines)) {
    throw HttpError.badRequest('distributors and lines must be supplied together, or omitted together');
  }
  let flattenedDestinations: FlattenedDestinationInput[] = [];
  if (input.lines) {
    if (input.lines.length === 0) throw HttpError.badRequest('At least one quantity line is required');
    flattenedDestinations = validateDistributorGroups(input.distributors!);
    validateLinesShape(flattenedDestinations, input.lines);
    await assertStylesAndSizesExist(
      [...new Set(input.lines.map((l) => l.styleId))],
      [...new Set(input.lines.map((l) => l.sizeId))],
    );
  }
  if (input.factoryId) {
    const factory = await prisma.factory.findUnique({ where: { id: input.factoryId } });
    if (!factory) throw HttpError.badRequest('Factory not found');
    if (factory.status !== 'ACTIVE') throw HttpError.badRequest('Factory is not active');
  }
  let distributorById = new Map<string, DistributorRow>();
  if (input.distributors) {
    distributorById = await loadAndValidateDistributors([...new Set(input.distributors.map((g) => g.distributorId))]);
  }

  const hash = requestHash(input);

  await prisma.$transaction(
    async (tx) => {
      const existingId = await findIdempotentSaleOrderId(tx, actor.id, 'UPDATE', idempotencyKey, hash, id);
      if (existingId) return;

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sale-order-${id}`}))`;

      const order = await tx.saleOrder.findUnique({
        where: { id },
        include: {
          distributorGroups: {
            include: { distributor: { select: { code: true } }, destinations: true },
          },
          lines: { include: { allocations: { where: { status: 'ACTIVE' } } } },
        },
      });
      if (!order) throw HttpError.notFound('Dispatch order not found');
      if (order.version !== input.expectedVersion) throw HttpError.staleVersion(order.version);
      if (await isDispatchOrderLocked(tx, id)) {
        throw HttpError.badRequest('This dispatch order is locked: Factory Dispatch has already occurred');
      }

      const existingGroups: LoadedGroup[] = order.distributorGroups.map((g) => ({
        id: g.id,
        distributorId: g.distributorId,
        purchaseMode: g.purchaseMode,
        code: g.distributor.code,
      }));
      const existingDestinations: LoadedDestination[] = order.distributorGroups.flatMap((g) =>
        g.destinations.map((d) => ({ id: d.id, saleOrderDistributorId: g.id })),
      );
      const destinationLabelById = new Map(
        order.distributorGroups.flatMap((g) => g.destinations.map((d) => [d.id, d.label] as const)),
      );

      const before = {
        distributors: existingGroups.map((g) => ({ distributorId: g.distributorId, code: g.code, purchaseMode: g.purchaseMode })),
        factoryId: order.factoryId,
        soDate: order.soDate.toISOString(),
        remarks: order.remarks,
        destinationCount: existingDestinations.length,
        lineCount: order.lines.length,
        totalQuantity: order.lines.reduce((sum, l) => sum + l.quantity, 0),
      };

      const allActiveAllocationIds = order.lines.flatMap((l) => l.allocations.map((a) => a.id));
      // Per-allocation attribution — retained for reallocation safety (which
      // StockAllocation's unpacked capacity is releasable), never for the
      // business "is this line packed" floor checks below (see
      // physicalPackedByLine / getPhysicalPackedQuantitiesForLines).
      const packedByAllocation = await loadPackedForAllocations(tx, allActiveAllocationIds);
      const factoryDispatchLinesByAllocation = await loadFactoryDispatchLinesByAllocation(tx, allActiveAllocationIds);

      // Cartons are the sole BUSINESS physical-packing authority (Phase 4) —
      // every packed-floor check in this function reads physical carton
      // totals, never FactoryDispatchLine.packedQuantity directly.
      const physicalPackedByLine = await getPhysicalPackedQuantitiesForLines(
        tx,
        order.lines.map((l) => l.id),
      );
      // Defensive consistency check: FactoryDispatchLine attribution must
      // always equal the physical carton total per line (every carton
      // mutation reconciles this inline) — an edit must not silently trust a
      // broken invariant, but it also must never guess at which allocation
      // to release when reconciling; a mismatch here is an internal bug.
      for (const line of order.lines) {
        const attributed = line.allocations.reduce((sum, a) => sum + (packedByAllocation.get(a.id) ?? 0), 0);
        const physical = physicalPackedByLine.get(line.id) ?? 0;
        if (attributed !== physical) {
          throw HttpError.internal(
            `Packing attribution inconsistency for line ${line.id}: attributed ${attributed} vs. physical ${physical}`,
          );
        }
      }

      // Correction 8: destination-move eligibility (canMoveDistributor)
      // shares the exact same predicate used by the read projection — cross-
      // group destination moves in this function reuse it below rather than
      // re-deriving "has this destination been packed" independently. The
      // order is already confirmed unlocked above, so this reduces to the
      // zero-cartons check, but it is computed via the one shared function.
      const canMoveByDestinationId = await computeCanMoveDistributor(
        tx,
        id,
        existingDestinations.map((d) => d.id),
      );

      const loadedLines: LoadedLine[] = order.lines.map((l) => ({
        id: l.id,
        destinationId: l.destinationId,
        styleId: l.styleId,
        sizeId: l.sizeId,
        quantity: l.quantity,
        allocations: l.allocations.map((a) => ({ id: a.id, qaReleaseLineId: a.qaReleaseLineId, quantity: a.quantity })),
      }));
      const packedForLine = (line: LoadedLine): number => physicalPackedByLine.get(line.id) ?? 0;

      const newFactoryId = input.factoryId ?? order.factoryId;
      const factoryChanging = newFactoryId !== order.factoryId;
      const linesChanging = Boolean(input.lines);

      let releaseCount = 0;
      let hardDeletedFactoryDispatchIds: string[] = [];
      const distributorsAdded: DistributorAuditEntry[] = [];
      const distributorsRemoved: DistributorAuditEntry[] = [];
      const destinationsMoved: DestinationMoveAuditEntry[] = [];

      // Distributor-group reconciliation — computed once, ahead of the
      // destination/line reconciliation, so new group ids exist before any
      // destination create/move references them. Runs identically whether
      // or not the Factory is also changing.
      let groupIdByClientKey = new Map<string, string>();
      let purchaseModeByGroupId = new Map<string, PurchaseMode>();
      let groupDeleteCandidateIds: string[] = [];

      if (linesChanging) {
        const reconciled = reconcileDistributorGroups(existingGroups, input.distributors!, distributorById);
        groupIdByClientKey = reconciled.groupIdByClientKey;
        groupDeleteCandidateIds = reconciled.groupDeleteCandidateIds;
        purchaseModeByGroupId = new Map(existingGroups.map((g) => [g.id, g.purchaseMode]));

        if (reconciled.groupCreates.length > 0) {
          await tx.saleOrderDistributor.createMany({
            data: reconciled.groupCreates.map((g) => ({ id: g.id, saleOrderId: id, distributorId: g.distributorId, purchaseMode: g.purchaseMode })),
          });
          for (const g of reconciled.groupCreates) {
            purchaseModeByGroupId.set(g.id, g.purchaseMode);
            const distributor = distributorById.get(g.distributorId)!;
            distributorsAdded.push({ distributorId: g.distributorId, code: distributor.code, purchaseMode: distributor.purchaseMode });
          }
        }
      }

      if (factoryChanging) {
        // §22/§2.3 Factory change: all-or-nothing across the ENTIRE order.
        const totalPacked = loadedLines.reduce((sum, line) => sum + packedForLine(line), 0);
        if (totalPacked > 0) {
          throw HttpError.badRequest(
            'Cannot change Factory: goods have already been packed at the current Factory. This requires Phase 4 unpack/repack support.',
          );
        }

        // Determine the desired line set: either the input's new lines, or
        // (if lines weren't supplied) the current lines re-reserved as-is
        // at the new factory.
        const desired = linesChanging
          ? resolveDesiredLinesForFullReplacement(
              existingDestinations,
              flattenedDestinations,
              input.lines!,
              groupIdByClientKey,
            )
          : {
              destinationCreates: [] as ReturnType<typeof resolveDesiredLinesForFullReplacement>['destinationCreates'],
              destinationUpdates: [] as ReturnType<typeof resolveDesiredLinesForFullReplacement>['destinationUpdates'],
              destinationDeleteIds: [] as string[],
              lineCreates: loadedLines.map((l) => ({
                id: l.id,
                destinationId: l.destinationId,
                styleId: l.styleId,
                sizeId: l.sizeId,
                quantity: l.quantity,
              })),
              lineFieldUpdates: [],
              lineDeleteIds: [],
              lineMerges: [] as Array<{ losingId: string; survivingId: string }>,
              destinationMoves: [] as Array<{ destinationId: string; fromGroupId: string; toGroupId: string }>,
            };

        // Release every current allocation (all guaranteed unpacked).
        for (const line of loadedLines) {
          for (const allocation of line.allocations) {
            await tx.stockAllocation.update({
              where: { id: allocation.id },
              data: { status: 'RELEASED', releasedById: actor.id, releasedAt: new Date() },
            });
            releaseCount += 1;
          }
        }

        // Clean up any empty DRAFT FactoryDispatch (safe: totalPacked === 0
        // proves nothing physical is packed against this order yet).
        const draftIds = (
          await tx.factoryDispatch.findMany({ where: { saleOrderId: id, status: 'DRAFT' }, select: { id: true } })
        ).map((d) => d.id);
        hardDeletedFactoryDispatchIds = draftIds;
        await hardDeleteFactoryDispatches(tx, draftIds);

        // Apply destination/line structural changes (creates/updates/deletes),
        // but treat EVERY resulting line as needing a fresh full reservation
        // at the new factory (old allocations are already fully released
        // above). New destinations are created FIRST (a new line may
        // reference one); destination UPDATES/DELETES run AFTER every line
        // change so a destination whose only line is being removed in this
        // same request is never deleted while a sale_order_lines row still
        // references it (FK RESTRICT) — a destination-with-its-line removal
        // is exactly what dropping a whole Distributor group produces.
        await applyDestinationPlan(tx, id, desired.destinationCreates, [], []);
        const finalLineIds = await applyLinePlan(
          tx,
          id,
          desired.lineCreates,
          desired.lineFieldUpdates,
          desired.lineDeleteIds,
        );
        // Now safe: every line that referenced a doomed destination is gone.
        await applyDestinationPlan(tx, id, [], desired.destinationUpdates, desired.destinationDeleteIds);

        for (const move of desired.destinationMoves) {
          const fromMode = purchaseModeByGroupId.get(move.fromGroupId);
          const toMode = purchaseModeByGroupId.get(move.toGroupId);
          const fromGroup = existingGroups.find((g) => g.id === move.fromGroupId);
          destinationsMoved.push({
            destinationId: move.destinationId,
            label: destinationLabelById.get(move.destinationId) ?? null,
            fromDistributorId: fromGroup?.distributorId ?? '',
            toDistributorId: resolveGroupDistributorId(move.toGroupId, existingGroups, input.distributors!, groupIdByClientKey),
            fromPurchaseMode: fromMode ?? '',
            toPurchaseMode: toMode ?? '',
          });
        }

        const demandByPoolKey = new Map<string, PoolDemandEntry[]>();
        for (const line of finalLineIds) {
          const key = poolKeyOf(line.styleId, line.sizeId);
          const list = demandByPoolKey.get(key) ?? [];
          list.push({ lineRef: line.id, destinationId: line.destinationId, neededQuantity: line.quantity });
          demandByPoolKey.set(key, list);
        }
        await lockPoolKeys(tx, newFactoryId, demandByPoolKey.keys());
        const plannedAllocations = await reserveAcrossPools(tx, newFactoryId, demandByPoolKey, new Map());
        await createAllocations(tx, actor.id, plannedAllocations);

        await tx.saleOrder.update({ where: { id }, data: { factoryId: newFactoryId } });
      } else if (linesChanging) {
        const desired = resolveDesiredLinesForReconciliation(
          existingDestinations,
          loadedLines,
          flattenedDestinations,
          input.lines!,
          groupIdByClientKey,
          canMoveByDestinationId,
          packedByAllocation,
          factoryDispatchLinesByAllocation,
          physicalPackedByLine,
        );

        // Execute merges first (re-point allocations before computing release/reserve deltas).
        for (const merge of desired.lineMerges) {
          await tx.stockAllocation.updateMany({
            where: { saleOrderLineId: merge.losingId },
            data: { saleOrderLineId: merge.survivingId },
          });
        }

        // Release the planned (packed-floor-respecting) portions.
        const plannedReleaseByReleaseLine = new Map<string, number>();
        for (const release of desired.allocationReleases) {
          const line = loadedLines.flatMap((l) => l.allocations).find((a) => a.id === release.allocationId);
          if (!line) continue;
          plannedReleaseByReleaseLine.set(
            line.qaReleaseLineId,
            (plannedReleaseByReleaseLine.get(line.qaReleaseLineId) ?? 0) + release.releaseAmount,
          );
          if (release.fullyRelease) {
            await tx.stockAllocation.update({
              where: { id: release.allocationId },
              data: { status: 'RELEASED', releasedById: actor.id, releasedAt: new Date() },
            });
          } else {
            await tx.stockAllocation.update({
              where: { id: release.allocationId },
              data: { quantity: { decrement: release.releaseAmount } },
            });
          }
          releaseCount += 1;
        }
        // Hard-deleted lines: fully release + delete their (unpacked) allocations.
        for (const allocationId of desired.allocationHardDeleteIds) {
          const alloc = loadedLines.flatMap((l) => l.allocations).find((a) => a.id === allocationId);
          if (alloc) {
            plannedReleaseByReleaseLine.set(
              alloc.qaReleaseLineId,
              (plannedReleaseByReleaseLine.get(alloc.qaReleaseLineId) ?? 0) + alloc.quantity,
            );
          }
          await tx.stockAllocation.delete({ where: { id: allocationId } });
        }
        // Zero-packed FactoryDispatchLine rows against a fully-removed line
        // must be cleared before the allocation/line can be deleted.
        if (desired.factoryDispatchLineDeleteIds.length > 0) {
          await tx.factoryDispatchLine.deleteMany({ where: { id: { in: desired.factoryDispatchLineDeleteIds } } });
        }

        // Phase 4: a destination becoming unreferenced by any line (the only
        // thing resolveDesiredLinesForReconciliation itself checks) is not
        // enough to make it deletable any more — FactoryPackingCarton.
        // destinationId is onDelete: Restrict, so a destination that still
        // has ANY carton (retired or not — a retired carton is an immutable
        // historical record permanently tied to its destination) must be
        // rejected with a clear message rather than surfacing a raw FK
        // constraint error.
        if (desired.destinationDeleteIds.length > 0) {
          const cartonedDestinations = await tx.factoryPackingCarton.findMany({
            where: { destinationId: { in: desired.destinationDeleteIds } },
            select: { destinationId: true },
            distinct: ['destinationId'],
          });
          if (cartonedDestinations.length > 0) {
            throw HttpError.badRequest(
              `Cannot remove destination(s) ${cartonedDestinations.map((c) => c.destinationId).join(', ')}: cartons have already been packed for them.`,
            );
          }
        }

        // New destinations FIRST (a new line may reference one); destination
        // UPDATES/DELETES run AFTER line changes so a destination whose only
        // line is being removed in this same request is never deleted while
        // a sale_order_lines row still references it (FK RESTRICT) — this is
        // exactly what dropping a whole Distributor group produces.
        await applyDestinationPlan(tx, id, desired.destinationCreates, [], []);
        await applyLinePlan(tx, id, desired.lineCreates, desired.lineFieldUpdates, desired.lineDeleteIds);
        await applyDestinationPlan(tx, id, [], desired.destinationUpdates, desired.destinationDeleteIds);

        for (const move of desired.destinationMoves) {
          const fromGroup = existingGroups.find((g) => g.id === move.fromGroupId);
          destinationsMoved.push({
            destinationId: move.destinationId,
            label: destinationLabelById.get(move.destinationId) ?? null,
            fromDistributorId: fromGroup?.distributorId ?? '',
            toDistributorId: resolveGroupDistributorId(move.toGroupId, existingGroups, input.distributors!, groupIdByClientKey),
            fromPurchaseMode: purchaseModeByGroupId.get(move.fromGroupId) ?? '',
            toPurchaseMode: purchaseModeByGroupId.get(move.toGroupId) ?? '',
          });
        }

        // Phase 4 carton invalidation: a destination ADDRESS edit or a
        // stable-line DESTINATION MOVE must invalidate the current Packing
        // Audit of every affected NON-RETIRED carton (retired cartons are
        // immutable historical records, never re-touched here). Only an
        // actual field change counts — round-tripping the same address
        // value must not invalidate anything.
        const editedDestinationIds = new Set<string>();
        if (input.distributors) {
          const existingDestById = new Map(order.distributorGroups.flatMap((g) => g.destinations.map((d) => [d.id, d])));
          for (const d of flattenedDestinations) {
            if (!d.id) continue;
            const existing = existingDestById.get(d.id);
            if (!existing) continue;
            const changed =
              (d.label ?? null) !== existing.label ||
              (d.contactName ?? null) !== existing.contactName ||
              (d.contactEmail ?? null) !== existing.contactEmail ||
              (d.contactPhone ?? null) !== existing.contactPhone ||
              d.addressLine1 !== existing.addressLine1 ||
              (d.addressLine2 ?? null) !== existing.addressLine2 ||
              d.city !== existing.city ||
              d.state !== existing.state ||
              d.country !== existing.country ||
              (d.postalCode ?? null) !== existing.postalCode ||
              (d.gstin ?? null) !== existing.gstin;
            if (changed) editedDestinationIds.add(d.id);
          }
        }

        const movedLineIds = new Set<string>();
        for (const update of desired.lineFieldUpdates) {
          const original = loadedLines.find((l) => l.id === update.id);
          if (original && original.destinationId !== update.destinationId) movedLineIds.add(update.id);
        }

        if (editedDestinationIds.size > 0 || movedLineIds.size > 0) {
          const orConditions: Prisma.FactoryPackingCartonWhereInput[] = [];
          if (editedDestinationIds.size > 0) orConditions.push({ destinationId: { in: [...editedDestinationIds] } });
          if (movedLineIds.size > 0) orConditions.push({ lines: { some: { saleOrderLineId: { in: [...movedLineIds] } } } });
          const affectedCartons = await tx.factoryPackingCarton.findMany({
            where: { factoryDispatch: { saleOrderId: id }, retiredAt: null, OR: orConditions },
            select: { id: true },
          });
          if (affectedCartons.length > 0) {
            await tx.factoryPackingCarton.updateMany({
              where: { id: { in: affectedCartons.map((c) => c.id) } },
              data: { version: { increment: 1 } },
            });
          }
        }

        if (desired.poolDemand.size > 0) {
          await lockPoolKeys(tx, newFactoryId, desired.poolDemand.keys());
          const plannedAllocations = await reserveAcrossPools(
            tx,
            newFactoryId,
            desired.poolDemand,
            plannedReleaseByReleaseLine,
          );
          await createOrMergeAllocations(tx, actor.id, plannedAllocations);
        }
      }

      if (!factoryChanging && !linesChanging) {
        // Header-only edit: no allocation changes at all.
      }

      // Delete groups no longer referenced — every destination that was
      // under them has already been either moved elsewhere or deleted above
      // as part of the ordinary destination reconciliation (a dropped
      // group's destinations simply stop appearing in the flattened input),
      // so this is always safe by construction; the composite FK is a real
      // backstop too. Runs LAST, after every destination write above.
      if (groupDeleteCandidateIds.length > 0) {
        for (const groupId of groupDeleteCandidateIds) {
          const group = existingGroups.find((g) => g.id === groupId)!;
          distributorsRemoved.push({ distributorId: group.distributorId, code: group.code, purchaseMode: group.purchaseMode });
        }
        await tx.saleOrderDistributor.deleteMany({ where: { id: { in: groupDeleteCandidateIds } } });
      }

      await tx.saleOrder.update({
        where: { id },
        data: {
          soDate: input.soDate ? new Date(input.soDate) : undefined,
          remarks: input.remarks !== undefined ? input.remarks : undefined,
          version: { increment: 1 },
        },
      });

      const after = await tx.saleOrder.findUnique({
        where: { id },
        include: { distributorGroups: { include: { distributor: { select: { code: true } } } }, destinations: true, lines: true },
      });
      const afterSummary = {
        distributors: after!.distributorGroups.map((g) => ({ distributorId: g.distributorId, code: g.distributor.code, purchaseMode: g.purchaseMode })),
        factoryId: after!.factoryId,
        soDate: after!.soDate.toISOString(),
        remarks: after!.remarks,
        destinationCount: after!.destinations.length,
        lineCount: after!.lines.length,
        totalQuantity: after!.lines.reduce((sum, l) => sum + l.quantity, 0),
      };

      await recordAuditLog(
        {
          actorId: actor.id,
          action: 'DISPATCH_ORDER_UPDATED',
          entityType: 'SaleOrder',
          entityId: id,
          metadata: {
            before,
            after: afterSummary,
            releasedAllocationCount: releaseCount,
            hardDeletedFactoryDispatchIds,
            distributorsAdded,
            distributorsRemoved,
            destinationsMoved,
            summary: `Total quantity ${before.totalQuantity} -> ${afterSummary.totalQuantity}`,
          } as unknown as Prisma.InputJsonValue,
        },
        tx,
      );
      await recordIdempotentOperation(tx, actor.id, id, 'UPDATE', idempotencyKey, hash, order.version + 1);
    },
    { timeout: 30000 },
  );

  return getSaleOrderDetail(actor, id);
}

// Resolves the distributorId a (possibly newly created) group id belongs to
// — used only for destinationsMoved audit entries, where the target group
// may be one created earlier in this same request.
function resolveGroupDistributorId(
  groupId: string,
  existingGroups: LoadedGroup[],
  distributorsInput: DispatchOrderDistributorGroupInput[],
  groupIdByClientKey: Map<string, string>,
): string {
  const existing = existingGroups.find((g) => g.id === groupId);
  if (existing) return existing.distributorId;
  const clientKey = [...groupIdByClientKey.entries()].find(([, gid]) => gid === groupId)?.[0];
  const input = distributorsInput.find((g) => g.clientKey === clientKey);
  return input?.distributorId ?? '';
}

// ---------------------------------------------------------------------------
// Update helpers
// ---------------------------------------------------------------------------

async function loadPackedForAllocations(tx: Tx, allocationIds: string[]): Promise<Map<string, number>> {
  if (allocationIds.length === 0) return new Map();
  const rows = await tx.factoryDispatchLine.groupBy({
    by: ['stockAllocationId'],
    where: { stockAllocationId: { in: allocationIds } },
    _sum: { packedQuantity: true },
  });
  return new Map(rows.map((r) => [r.stockAllocationId, r._sum.packedQuantity ?? 0]));
}

async function loadFactoryDispatchLinesByAllocation(tx: Tx, allocationIds: string[]): Promise<Map<string, string[]>> {
  if (allocationIds.length === 0) return new Map();
  const rows = await tx.factoryDispatchLine.findMany({
    where: { stockAllocationId: { in: allocationIds } },
    select: { id: true, stockAllocationId: true },
  });
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.stockAllocationId) ?? [];
    list.push(row.id);
    map.set(row.stockAllocationId, list);
  }
  return map;
}

async function createAllocations(tx: Tx, actorId: string, allocations: PlannedAllocation[]): Promise<void> {
  for (const allocation of allocations) {
    await tx.stockAllocation.create({
      data: {
        id: createId(),
        saleOrderLineId: allocation.lineRef,
        qaReleaseLineId: allocation.qaReleaseLineId,
        quantity: allocation.quantity,
        status: 'ACTIVE',
        allocationSource: 'MERCHANDISER_ALLOCATION',
        allocatedById: actorId,
      },
    });
  }
}

// Merge, don't duplicate: if this line already holds an ACTIVE allocation
// against the same QaReleaseLine, increment it in place (preserving any
// packing reference already attached) instead of creating a second row for
// the same (saleOrderLineId, qaReleaseLineId) pair.
async function createOrMergeAllocations(tx: Tx, actorId: string, allocations: PlannedAllocation[]): Promise<void> {
  for (const allocation of allocations) {
    const existing = await tx.stockAllocation.findUnique({
      where: {
        saleOrderLineId_qaReleaseLineId: { saleOrderLineId: allocation.lineRef, qaReleaseLineId: allocation.qaReleaseLineId },
      },
    });
    if (existing && existing.status === 'ACTIVE') {
      await tx.stockAllocation.update({
        where: { id: existing.id },
        data: { quantity: { increment: allocation.quantity } },
      });
    } else if (existing) {
      await tx.stockAllocation.update({
        where: { id: existing.id },
        data: {
          status: 'ACTIVE',
          quantity: allocation.quantity,
          allocatedById: actorId,
          releasedById: null,
          releasedAt: null,
        },
      });
    } else {
      await tx.stockAllocation.create({
        data: {
          id: createId(),
          saleOrderLineId: allocation.lineRef,
          qaReleaseLineId: allocation.qaReleaseLineId,
          quantity: allocation.quantity,
          status: 'ACTIVE',
          allocationSource: 'MERCHANDISER_ALLOCATION',
          allocatedById: actorId,
        },
      });
    }
  }
}

interface DestinationFields {
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
}

function toDestinationFields(d: DispatchOrderDestinationInput): DestinationFields {
  return {
    label: d.label ?? null,
    contactName: d.contactName ?? null,
    contactEmail: d.contactEmail ?? null,
    contactPhone: d.contactPhone ?? null,
    addressLine1: d.addressLine1,
    addressLine2: d.addressLine2 ?? null,
    city: d.city,
    state: d.state,
    country: d.country,
    postalCode: d.postalCode ?? null,
    gstin: d.gstin ?? null,
  };
}

// Distributor-group reconciliation — resolves which groups are new
// (created here, before any destination references them), which existing
// groups are kept (an existing group's distributorId is immutable: a
// request that tries to repoint it is rejected outright rather than
// silently mutating historical lineage), and which existing groups are no
// longer referenced at all (candidates for deletion once their
// destinations have been moved/removed by the destination reconciliation
// below).
function reconcileDistributorGroups(
  existingGroups: LoadedGroup[],
  distributorsInput: DispatchOrderDistributorGroupInput[],
  distributorById: Map<string, DistributorRow>,
): {
  groupCreates: Array<{ id: string; distributorId: string; purchaseMode: PurchaseMode }>;
  groupIdByClientKey: Map<string, string>;
  groupDeleteCandidateIds: string[];
} {
  const existingGroupById = new Map(existingGroups.map((g) => [g.id, g]));
  const groupCreates: Array<{ id: string; distributorId: string; purchaseMode: PurchaseMode }> = [];
  const groupIdByClientKey = new Map<string, string>();
  const seenExistingGroupIds = new Set<string>();

  for (const g of distributorsInput) {
    if (g.id) {
      const existing = existingGroupById.get(g.id);
      if (!existing) throw HttpError.badRequest(`Distributor group ${g.id} does not belong to this dispatch order`);
      if (seenExistingGroupIds.has(g.id)) throw HttpError.badRequest(`Distributor group ${g.id} referenced more than once`);
      if (existing.distributorId !== g.distributorId) {
        throw HttpError.badRequest(
          `Cannot change the Distributor of an existing group (${g.id}) — remove it and add a new one instead`,
        );
      }
      seenExistingGroupIds.add(g.id);
      groupIdByClientKey.set(g.clientKey, g.id);
    } else {
      const newId = createId();
      const distributor = distributorById.get(g.distributorId)!;
      groupCreates.push({ id: newId, distributorId: g.distributorId, purchaseMode: distributor.purchaseMode });
      groupIdByClientKey.set(g.clientKey, newId);
    }
  }
  const groupDeleteCandidateIds = existingGroups.map((g) => g.id).filter((gid) => !seenExistingGroupIds.has(gid));

  return { groupCreates, groupIdByClientKey, groupDeleteCandidateIds };
}

async function applyDestinationPlan(
  tx: Tx,
  saleOrderId: string,
  creates: Array<{ id: string; saleOrderDistributorId: string; data: DestinationFields }>,
  updates: Array<{ id: string; saleOrderDistributorId?: string; data: DestinationFields }>,
  deleteIds: string[],
): Promise<void> {
  for (const create of creates) {
    await tx.saleOrderDestination.create({
      data: { id: create.id, saleOrderId, saleOrderDistributorId: create.saleOrderDistributorId, ...create.data },
    });
  }
  for (const update of updates) {
    await tx.saleOrderDestination.update({
      where: { id: update.id },
      data: {
        ...update.data,
        ...(update.saleOrderDistributorId ? { saleOrderDistributorId: update.saleOrderDistributorId } : {}),
      },
    });
  }
  if (deleteIds.length > 0) {
    await tx.saleOrderDestination.deleteMany({ where: { id: { in: deleteIds } } });
  }
}

async function applyLinePlan(
  tx: Tx,
  saleOrderId: string,
  creates: Array<{ id: string; destinationId: string; styleId: string; sizeId: string; quantity: number }>,
  updates: Array<{ id: string; destinationId: string; styleId: string; sizeId: string; quantity: number }>,
  deleteIds: string[],
): Promise<Array<{ id: string; destinationId: string; styleId: string; sizeId: string; quantity: number }>> {
  if (deleteIds.length > 0) {
    await tx.saleOrderLine.deleteMany({ where: { id: { in: deleteIds } } });
  }
  for (const update of updates) {
    await tx.saleOrderLine.update({
      where: { id: update.id },
      data: { destinationId: update.destinationId, styleId: update.styleId, sizeId: update.sizeId, quantity: update.quantity },
    });
  }
  if (creates.length > 0) {
    await tx.saleOrderLine.createMany({
      data: creates.map((c) => ({
        id: c.id,
        saleOrderId,
        destinationId: c.destinationId,
        styleId: c.styleId,
        sizeId: c.sizeId,
        quantity: c.quantity,
      })),
    });
  }
  return [...updates, ...creates];
}

// Used only by the Factory-change path (every current allocation has
// already been fully released, so this is a plain structural replacement —
// no packed-floor guards apply here; every destination move is trivially
// safe since totalPacked === 0 is already guaranteed upstream).
function resolveDesiredLinesForFullReplacement(
  existingDestinations: LoadedDestination[],
  destinationsInput: FlattenedDestinationInput[],
  linesInput: DispatchOrderLineInput[],
  groupIdByClientKey: Map<string, string>,
) {
  const existingDestById = new Map(existingDestinations.map((d) => [d.id, d]));
  const existingDestIds = new Set(existingDestinations.map((d) => d.id));
  const destinationCreates: Array<{ id: string; saleOrderDistributorId: string; clientKey: string; data: DestinationFields }> = [];
  const destinationUpdates: Array<{ id: string; saleOrderDistributorId?: string; data: DestinationFields }> = [];
  const destinationMoves: Array<{ destinationId: string; fromGroupId: string; toGroupId: string }> = [];
  const resolvedDestinationId = new Map<string, string>();
  const seenExistingDestIds = new Set<string>();

  for (const d of destinationsInput) {
    const targetGroupId = groupIdByClientKey.get(d.groupClientKey)!;
    if (d.id) {
      if (!existingDestIds.has(d.id)) throw HttpError.badRequest(`Destination ${d.id} does not belong to this dispatch order`);
      if (seenExistingDestIds.has(d.id)) throw HttpError.badRequest(`Destination ${d.id} referenced more than once`);
      seenExistingDestIds.add(d.id);
      const existing = existingDestById.get(d.id)!;
      const isMoving = existing.saleOrderDistributorId !== targetGroupId;
      if (isMoving) destinationMoves.push({ destinationId: d.id, fromGroupId: existing.saleOrderDistributorId, toGroupId: targetGroupId });
      destinationUpdates.push({ id: d.id, saleOrderDistributorId: isMoving ? targetGroupId : undefined, data: toDestinationFields(d) });
      resolvedDestinationId.set(d.clientKey, d.id);
    } else {
      const newId = createId();
      destinationCreates.push({ id: newId, saleOrderDistributorId: targetGroupId, clientKey: d.clientKey, data: toDestinationFields(d) });
      resolvedDestinationId.set(d.clientKey, newId);
    }
  }
  const destinationDeleteIds = [...existingDestIds].filter((destId) => !seenExistingDestIds.has(destId));

  const lineCreates = linesInput.map((line) => ({
    id: createId(),
    destinationId: resolvedDestinationId.get(line.destinationClientKey)!,
    styleId: line.styleId,
    sizeId: line.sizeId,
    quantity: line.quantity,
  }));

  return {
    destinationCreates,
    destinationUpdates,
    destinationDeleteIds,
    destinationMoves,
    lineCreates,
    lineFieldUpdates: [] as Array<{ id: string; destinationId: string; styleId: string; sizeId: string; quantity: number }>,
    lineDeleteIds: [] as string[],
    lineMerges: [] as Array<{ losingId: string; survivingId: string }>,
  };
}

// The full surgical reconciliation planner (no factory change) — see the
// Phase 3 plan §2.3 Phase B. Validates line/destination identity, computes
// packed-floor rejections, resolves destination moves (both style/size
// changes on unpacked lines AND, per Correction 8, Distributor-group
// changes on unpacked destinations — the latter gated on zero cartons via
// the same computeCanMoveDistributor predicate the read projection uses),
// detects and merges 2-way collisions, and produces the destination/line
// write plan plus the per-pool-key additional demand needed.
function resolveDesiredLinesForReconciliation(
  existingDestinations: LoadedDestination[],
  existingLines: LoadedLine[],
  destinationsInput: FlattenedDestinationInput[],
  linesInput: DispatchOrderLineInput[],
  groupIdByClientKey: Map<string, string>,
  canMoveByDestinationId: Map<string, boolean>,
  packedByAllocation: Map<string, number>,
  factoryDispatchLinesByAllocation: Map<string, string[]>,
  physicalPackedByLine: Map<string, number>,
) {
  // packedForAllocation drives the RELEASE-AMOUNT math only (which specific
  // StockAllocation's unpacked capacity is releasable) — unaffected by
  // Phase 4. packedForLine drives every FLOOR check (style/size change,
  // line removal, quantity reduction) and now reads the physical carton
  // total, per the Phase 4 plan §1 correction.
  const packedForAllocation = (allocationId: string): number => packedByAllocation.get(allocationId) ?? 0;
  const packedForLine = (line: LoadedLine): number => physicalPackedByLine.get(line.id) ?? 0;
  const existingDestById = new Map(existingDestinations.map((d) => [d.id, d]));
  const existingDestIds = new Set(existingDestinations.map((d) => d.id));
  const existingLineById = new Map(existingLines.map((l) => [l.id, l]));

  // --- Destinations ---
  const destinationCreates: Array<{ id: string; saleOrderDistributorId: string; clientKey: string; data: DestinationFields }> = [];
  const destinationUpdates: Array<{ id: string; saleOrderDistributorId?: string; data: DestinationFields }> = [];
  const destinationMoves: Array<{ destinationId: string; fromGroupId: string; toGroupId: string }> = [];
  const resolvedDestinationId = new Map<string, string>();
  const seenExistingDestIds = new Set<string>();

  for (const d of destinationsInput) {
    const targetGroupId = groupIdByClientKey.get(d.groupClientKey)!;
    if (d.id) {
      if (!existingDestIds.has(d.id)) throw HttpError.badRequest(`Destination ${d.id} does not belong to this dispatch order`);
      if (seenExistingDestIds.has(d.id)) throw HttpError.badRequest(`Destination ${d.id} referenced more than once`);
      seenExistingDestIds.add(d.id);
      const existing = existingDestById.get(d.id)!;
      const isMoving = existing.saleOrderDistributorId !== targetGroupId;
      if (isMoving) {
        if (!canMoveByDestinationId.get(d.id)) {
          throw HttpError.badRequest(
            `Cannot move destination ${d.id} to a different Distributor: cartons have already been packed for it.`,
          );
        }
        destinationMoves.push({ destinationId: d.id, fromGroupId: existing.saleOrderDistributorId, toGroupId: targetGroupId });
      }
      destinationUpdates.push({ id: d.id, saleOrderDistributorId: isMoving ? targetGroupId : undefined, data: toDestinationFields(d) });
      resolvedDestinationId.set(d.clientKey, d.id);
    } else {
      const newId = createId();
      destinationCreates.push({ id: newId, saleOrderDistributorId: targetGroupId, clientKey: d.clientKey, data: toDestinationFields(d) });
      resolvedDestinationId.set(d.clientKey, newId);
    }
  }
  const destinationDeleteCandidateIds = [...existingDestIds].filter((destId) => !seenExistingDestIds.has(destId));

  // --- Lines: validate ids ---
  const seenExistingLineIds = new Set<string>();
  for (const line of linesInput) {
    if (line.id) {
      if (!existingLineById.has(line.id)) throw HttpError.badRequest(`Line ${line.id} does not belong to this dispatch order`);
      if (seenExistingLineIds.has(line.id)) throw HttpError.badRequest(`Line ${line.id} referenced more than once`);
      seenExistingLineIds.add(line.id);
    }
  }

  // --- Resolve target keys for every input line ---
  interface ResolvedEntry {
    originId: string | null;
    targetDestinationId: string;
    targetStyleId: string;
    targetSizeId: string;
    targetQuantity: number;
    packed: number;
  }
  const resolvedEntries: ResolvedEntry[] = linesInput.map((line) => {
    const originId = line.id ?? null;
    const existing = originId ? existingLineById.get(originId)! : null;
    const targetDestinationId = resolvedDestinationId.get(line.destinationClientKey)!;
    const packed = existing ? packedForLine(existing) : 0;
    if (existing && (line.styleId !== existing.styleId || line.sizeId !== existing.sizeId) && packed > 0) {
      throw HttpError.badRequest(
        `Line ${existing.id}: cannot change Style/Size on a line the Factory has already packed (packed ${packed} unit(s)). This requires Phase 4 packing reconciliation.`,
      );
    }
    return {
      originId,
      targetDestinationId,
      targetStyleId: line.styleId,
      targetSizeId: line.sizeId,
      targetQuantity: line.quantity,
      packed,
    };
  });

  // --- Group by target key to detect collisions ---
  const groups = new Map<string, ResolvedEntry[]>();
  for (const entry of resolvedEntries) {
    const key = `${entry.targetDestinationId}:${entry.targetStyleId}:${entry.targetSizeId}`;
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }

  const lineFieldUpdates: Array<{ id: string; destinationId: string; styleId: string; sizeId: string; quantity: number }> = [];
  const lineCreates: Array<{ id: string; destinationId: string; styleId: string; sizeId: string; quantity: number }> = [];
  const lineMerges: Array<{ losingId: string; survivingId: string }> = [];
  const finalQuantityByLineId = new Map<string, number>(); // keyed by the SURVIVING line's id (existing or newly created)
  const finalKeyByLineId = new Map<string, { destinationId: string; styleId: string; sizeId: string }>();

  for (const [, group] of groups) {
    if (group.length > 2) {
      throw HttpError.badRequest(
        'More than two lines resolve to the same destination/style/size after this edit — combine them manually before saving.',
      );
    }
    const totalQuantity = group.reduce((sum, e) => sum + e.targetQuantity, 0);
    // Prefer a group member with an existing row (and, among those, the one
    // with packed quantity) as the survivor so packing references are kept.
    const withOrigin = group.filter((e) => e.originId);
    const survivor = withOrigin.sort((a, b) => b.packed - a.packed)[0] ?? group[0]!;

    if (survivor.originId) {
      lineFieldUpdates.push({
        id: survivor.originId,
        destinationId: survivor.targetDestinationId,
        styleId: survivor.targetStyleId,
        sizeId: survivor.targetSizeId,
        quantity: totalQuantity,
      });
      finalQuantityByLineId.set(survivor.originId, totalQuantity);
      finalKeyByLineId.set(survivor.originId, {
        destinationId: survivor.targetDestinationId,
        styleId: survivor.targetStyleId,
        sizeId: survivor.targetSizeId,
      });
      for (const other of group) {
        if (other === survivor) continue;
        if (other.originId) lineMerges.push({ losingId: other.originId, survivingId: survivor.originId });
      }
    } else {
      const newId = createId();
      lineCreates.push({
        id: newId,
        destinationId: survivor.targetDestinationId,
        styleId: survivor.targetStyleId,
        sizeId: survivor.targetSizeId,
        quantity: totalQuantity,
      });
      finalQuantityByLineId.set(newId, totalQuantity);
      finalKeyByLineId.set(newId, {
        destinationId: survivor.targetDestinationId,
        styleId: survivor.targetStyleId,
        sizeId: survivor.targetSizeId,
      });
    }
  }

  // --- Removed lines (no input line references their id, and not absorbed by a merge) ---
  const mergedAwayIds = new Set(lineMerges.map((m) => m.losingId));
  const keptOrMergedIds = new Set([...seenExistingLineIds]);
  const lineDeleteIds: string[] = [];
  const allocationReleases: Array<{ allocationId: string; releaseAmount: number; fullyRelease: boolean }> = [];
  const allocationHardDeleteIds: string[] = [];
  const factoryDispatchLineDeleteIds: string[] = [];

  for (const line of existingLines) {
    if (keptOrMergedIds.has(line.id)) continue;
    const packed = packedForLine(line);
    if (packed > 0) {
      throw HttpError.badRequest(
        `Cannot remove line ${line.id}: the Factory has already packed ${packed} unit(s) against it.`,
      );
    }
    for (const allocation of line.allocations) {
      allocationHardDeleteIds.push(allocation.id);
      const zeroPackedRows = factoryDispatchLinesByAllocation.get(allocation.id) ?? [];
      factoryDispatchLineDeleteIds.push(...zeroPackedRows);
    }
    lineDeleteIds.push(line.id);
  }
  const destinationDeleteIds = destinationDeleteCandidateIds.filter((destId) => {
    // Only actually delete once nothing references it any more.
    const stillReferenced = [...finalKeyByLineId.values()].some((k) => k.destinationId === destId);
    return !stillReferenced;
  });

  // --- Quantity deltas for lines kept in place (not merged, not moved into a new key) ---
  for (const line of existingLines) {
    if (lineDeleteIds.includes(line.id) || mergedAwayIds.has(line.id)) continue;
    const finalQuantity = finalQuantityByLineId.get(line.id);
    if (finalQuantity === undefined) continue; // handled as an update already recorded above only if in lineFieldUpdates
    const oldQuantity = line.quantity;
    if (finalQuantity === oldQuantity) continue;
    if (finalQuantity < oldQuantity) {
      const packed = packedForLine(line);
      if (finalQuantity < packed) {
        throw HttpError.badRequest(
          `Line ${line.id}: cannot reduce quantity to ${finalQuantity} below the ${packed} unit(s) already packed by the Factory.`,
        );
      }
      let remaining = oldQuantity - finalQuantity;
      // Newest-created-first is not available here (only id, quantity are
      // loaded) — id is a cuid/ulid-style sortable identifier in this
      // codebase, so descending id is a stable, deterministic proxy for
      // newest-first, matching the pre-existing approve flow's convention.
      const orderedAllocations = [...line.allocations].sort((a, b) => b.id.localeCompare(a.id));
      for (const allocation of orderedAllocations) {
        if (remaining <= 0) break;
        const releasable = allocation.quantity - packedForAllocation(allocation.id);
        if (releasable <= 0) continue;
        const releaseAmount = Math.min(remaining, releasable);
        remaining -= releaseAmount;
        allocationReleases.push({
          allocationId: allocation.id,
          releaseAmount,
          fullyRelease: releaseAmount === allocation.quantity,
        });
      }
    }
  }

  // --- Additional demand needed per pool key (new lines + increased lines + merges) ---
  const poolDemand = new Map<string, PoolDemandEntry[]>();
  const addDemand = (lineRef: string, destinationId: string, styleId: string, sizeId: string, extra: number) => {
    if (extra <= 0) return;
    const key = poolKeyOf(styleId, sizeId);
    const list = poolDemand.get(key) ?? [];
    list.push({ lineRef, destinationId, neededQuantity: extra });
    poolDemand.set(key, list);
  };

  for (const update of lineFieldUpdates) {
    const originalLine = existingLineById.get(update.id);
    const priorCommitted = originalLine ? originalLine.allocations.reduce((s, a) => s + a.quantity, 0) : 0;
    const extra = update.quantity - priorCommitted;
    addDemand(update.id, update.destinationId, update.styleId, update.sizeId, extra);
  }
  for (const create of lineCreates) {
    addDemand(create.id, create.destinationId, create.styleId, create.sizeId, create.quantity);
  }

  return {
    destinationCreates,
    destinationUpdates,
    destinationDeleteIds,
    destinationMoves,
    lineCreates,
    lineFieldUpdates,
    lineDeleteIds,
    lineMerges,
    allocationReleases,
    allocationHardDeleteIds,
    factoryDispatchLineDeleteIds,
    poolDemand,
  };
}
