import { createId } from '@erve/shared';
import { createHash } from 'node:crypto';
import { Prisma, prisma } from '../../db/prisma.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import { getSoleFactoryId, requireFactoryAccess } from '../../auth/access.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { ensureFinancialYear } from '../master-data/financial-year.service.js';
import { allocateDocumentSerial } from '../master-data/document-sequence.service.js';
import { DOCUMENT_PREFIXES, formatDocumentNumber } from '../master-data/document-number.util.js';
import { getAvailableQuantities, getEligibleQaReleaseLinesForPool } from '../job-orders/pooled-inventory.service.js';
import { computeDispatchOrderFulfillment } from '../fulfillment/fulfillment-progress.js';
import { hardDeleteFactoryDispatches } from '../fulfillment/factory-dispatch.service.js';

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
  distributor: { select: { id: true, code: true, name: true, purchaseMode: true } },
  factory: { select: { id: true, code: true, name: true } },
  creator: { select: { id: true, name: true, email: true } },
  financialYear: { select: { id: true, code: true } },
  destinations: { orderBy: { createdAt: 'asc' as const } },
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
type SODestinationRecord = SORecord['destinations'][number];

function toDestinationView(destination: SODestinationRecord) {
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

async function toSaleOrderView(order: SORecord) {
  const isLocked = await isDispatchOrderLocked(prisma, order.id);
  const fulfillment = await computeDispatchOrderFulfillment(
    prisma,
    order.id,
    order.lines.map((line) => ({ quantity: line.quantity })),
  );
  const lines = order.lines.map(toLineView);
  return {
    id: order.id,
    saleOrderNumber: order.saleOrderNumber,
    distributor: order.distributor,
    factory: order.factory,
    financialYear: order.financialYear,
    soDate: order.soDate.toISOString(),
    status: order.status,
    destinationCount: order.destinations.length,
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    createdAt: order.createdAt.toISOString(),
    isLocked,
    creator: order.creator,
    remarks: order.remarks,
    destinations: order.destinations.map(toDestinationView),
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
// produced at most once per call.
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
      throw HttpError.conflict(
        `Insufficient pooled stock for Style/Size ${styleId}/${sizeId} at the selected Factory: short by ${shortfall} unit(s)`,
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
}

export interface DispatchOrderLineInput {
  id?: string;
  destinationClientKey: string;
  styleId: string;
  sizeId: string;
  quantity: number;
}

export interface CreateDispatchOrderInput {
  distributorId: string;
  factoryId: string;
  soDate: string;
  remarks?: string | null;
  destinations: DispatchOrderDestinationInput[];
  lines: DispatchOrderLineInput[];
}

export interface UpdateDispatchOrderInput {
  expectedVersion: number;
  distributorId?: string;
  factoryId?: string;
  soDate?: string;
  remarks?: string | null;
  destinations?: DispatchOrderDestinationInput[];
  lines?: DispatchOrderLineInput[];
}

function validateDestinationClientKeys(destinations: DispatchOrderDestinationInput[]): void {
  if (destinations.length === 0) throw HttpError.badRequest('At least one destination is required');
  const keys = destinations.map((d) => d.clientKey);
  if (keys.some((k) => !k?.trim())) throw HttpError.badRequest('Every destination must have a non-empty clientKey');
  if (new Set(keys).size !== keys.length) throw HttpError.badRequest('Duplicate destination clientKey');
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

// ---------------------------------------------------------------------------
// Service methods — reads
// ---------------------------------------------------------------------------

export async function getSaleOrderList(
  user: CurrentUser,
  filters: { search?: string; distributorId?: string; factoryId?: string; financialYearId?: string; cursor?: string; limit: number },
) {
  const factoryIdFilter = resolveListFactoryScope(user, filters.factoryId);

  const where: Prisma.SaleOrderWhereInput = {
    distributorId: filters.distributorId,
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

export async function getSaleOrderDetail(user: CurrentUser, id: string) {
  const order = await prisma.saleOrder.findUnique({ where: { id }, include: soInclude });
  if (!order) throw HttpError.notFound('Dispatch order not found');
  assertDispatchOrderViewAccess(user, order);
  return toSaleOrderView(order);
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
        detail =
          totalQuantity !== undefined && lineCount !== undefined
            ? `${totalQuantity} unit(s) reserved across ${lineCount} line(s)`
            : null;
        break;
      }
      case 'DISPATCH_ORDER_UPDATED': {
        const summary = typeof metadata.summary === 'string' ? metadata.summary : undefined;
        detail = summary ?? null;
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
  if (input.destinations.some((destination) => destination.id)) {
    throw HttpError.badRequest('Destination ids may only be supplied when correcting an existing dispatch order');
  }
  validateDestinationClientKeys(input.destinations);
  validateLinesShape(input.destinations, input.lines);

  const [distributor, factory] = await Promise.all([
    prisma.distributor.findUnique({ where: { id: input.distributorId } }),
    prisma.factory.findUnique({ where: { id: input.factoryId } }),
  ]);
  if (!distributor) throw HttpError.badRequest('Distributor not found');
  if (distributor.status !== 'ACTIVE') throw HttpError.badRequest('Distributor is not active');
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

    const destinationIdByClientKey = new Map(input.destinations.map((d) => [d.clientKey, createId()]));
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
        distributorId: input.distributorId,
        factoryId: input.factoryId,
        createdBy: actor.id,
        soDate: new Date(input.soDate),
        remarks: input.remarks ?? null,
        financialYearId: financialYear.id,
        soSerial: saleOrderSerial,
        destinations: {
          create: input.destinations.map((d) => ({
            id: destinationIdByClientKey.get(d.clientKey)!,
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
          })),
        },
      },
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

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'DISPATCH_ORDER_CREATED',
        entityType: 'SaleOrder',
        entityId: soId,
        metadata: {
          saleOrderNumber,
          distributorId: input.distributorId,
          factoryId: input.factoryId,
          destinationCount: input.destinations.length,
          lineCount: lineDefs.length,
          totalQuantity: lineDefs.reduce((sum, l) => sum + l.quantity, 0),
        },
      },
      tx,
    );
    await recordIdempotentOperation(tx, actor.id, soId, 'CREATE', idempotencyKey, hash, 1);
    return soId;
  });

  return getSaleOrderDetail(actor, resultId);
}

// ---------------------------------------------------------------------------
// updateDispatchOrder — surgical line-level sync (see the Phase 3 plan §2.3)
// ---------------------------------------------------------------------------

interface LoadedLine {
  id: string;
  destinationId: string;
  styleId: string;
  sizeId: string;
  quantity: number;
  allocations: Array<{ id: string; qaReleaseLineId: string; quantity: number }>;
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
  if (Boolean(input.destinations) !== Boolean(input.lines)) {
    throw HttpError.badRequest('destinations and lines must be supplied together, or omitted together');
  }
  if (input.lines) {
    if (input.lines.length === 0) throw HttpError.badRequest('At least one quantity line is required');
    validateDestinationClientKeys(input.destinations!);
    validateLinesShape(input.destinations!, input.lines);
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
  if (input.distributorId) {
    const distributor = await prisma.distributor.findUnique({ where: { id: input.distributorId } });
    if (!distributor) throw HttpError.badRequest('Distributor not found');
    if (distributor.status !== 'ACTIVE') throw HttpError.badRequest('Distributor is not active');
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
          destinations: true,
          lines: { include: { allocations: { where: { status: 'ACTIVE' } } } },
        },
      });
      if (!order) throw HttpError.notFound('Dispatch order not found');
      if (order.version !== input.expectedVersion) throw HttpError.staleVersion(order.version);
      if (await isDispatchOrderLocked(tx, id)) {
        throw HttpError.badRequest('This dispatch order is locked: Factory Dispatch has already occurred');
      }

      const before = {
        distributorId: order.distributorId,
        factoryId: order.factoryId,
        soDate: order.soDate.toISOString(),
        remarks: order.remarks,
        destinationCount: order.destinations.length,
        lineCount: order.lines.length,
        totalQuantity: order.lines.reduce((sum, l) => sum + l.quantity, 0),
      };

      const allActiveAllocationIds = order.lines.flatMap((l) => l.allocations.map((a) => a.id));
      const packedByAllocation = await loadPackedForAllocations(tx, allActiveAllocationIds);
      const factoryDispatchLinesByAllocation = await loadFactoryDispatchLinesByAllocation(tx, allActiveAllocationIds);

      const loadedLines: LoadedLine[] = order.lines.map((l) => ({
        id: l.id,
        destinationId: l.destinationId,
        styleId: l.styleId,
        sizeId: l.sizeId,
        quantity: l.quantity,
        allocations: l.allocations.map((a) => ({ id: a.id, qaReleaseLineId: a.qaReleaseLineId, quantity: a.quantity })),
      }));
      const packedForLine = (line: LoadedLine): number =>
        line.allocations.reduce((sum, a) => sum + (packedByAllocation.get(a.id) ?? 0), 0);

      const newFactoryId = input.factoryId ?? order.factoryId;
      const factoryChanging = newFactoryId !== order.factoryId;
      const linesChanging = Boolean(input.lines);

      let releaseCount = 0;
      let hardDeletedFactoryDispatchIds: string[] = [];

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
          ? resolveDesiredLinesForFullReplacement(order.destinations, loadedLines, input.destinations!, input.lines!)
          : {
              destinationCreates: [] as ReturnType<typeof resolveDesiredLinesForFullReplacement>['destinationCreates'],
              destinationUpdates: [],
              destinationDeleteIds: [],
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
        // at the new factory (old allocations are already fully released above).
        await applyDestinationPlan(tx, id, desired.destinationCreates, desired.destinationUpdates, desired.destinationDeleteIds);
        const finalLineIds = await applyLinePlan(
          tx,
          id,
          desired.lineCreates,
          desired.lineFieldUpdates,
          desired.lineDeleteIds,
          desired.lineMerges,
        );

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
          order.destinations,
          loadedLines,
          input.destinations!,
          input.lines!,
          packedByAllocation,
          factoryDispatchLinesByAllocation,
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

        await applyDestinationPlan(tx, id, desired.destinationCreates, desired.destinationUpdates, desired.destinationDeleteIds);
        await applyLinePlan(tx, id, desired.lineCreates, desired.lineFieldUpdates, desired.lineDeleteIds, []);

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

      await tx.saleOrder.update({
        where: { id },
        data: {
          distributorId: input.distributorId,
          soDate: input.soDate ? new Date(input.soDate) : undefined,
          remarks: input.remarks !== undefined ? input.remarks : undefined,
          version: { increment: 1 },
        },
      });

      const after = await tx.saleOrder.findUnique({
        where: { id },
        include: { destinations: true, lines: true },
      });
      const afterSummary = {
        distributorId: after!.distributorId,
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
            summary: `Total quantity ${before.totalQuantity} -> ${afterSummary.totalQuantity}`,
          },
        },
        tx,
      );
      await recordIdempotentOperation(tx, actor.id, id, 'UPDATE', idempotencyKey, hash, order.version + 1);
    },
    { timeout: 30000 },
  );

  return getSaleOrderDetail(actor, id);
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
  };
}

async function applyDestinationPlan(
  tx: Tx,
  saleOrderId: string,
  creates: Array<{ id: string; data: DestinationFields }>,
  updates: Array<{ id: string; data: DestinationFields }>,
  deleteIds: string[],
): Promise<void> {
  for (const create of creates) {
    await tx.saleOrderDestination.create({ data: { id: create.id, saleOrderId, ...create.data } });
  }
  for (const update of updates) {
    await tx.saleOrderDestination.update({ where: { id: update.id }, data: update.data });
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
  _merges: Array<{ losingId: string; survivingId: string }>,
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
// no packed-floor guards apply here).
function resolveDesiredLinesForFullReplacement(
  existingDestinations: Array<{ id: string }>,
  _existingLines: LoadedLine[],
  destinationsInput: DispatchOrderDestinationInput[],
  linesInput: DispatchOrderLineInput[],
) {
  const existingDestIds = new Set(existingDestinations.map((d) => d.id));
  const destinationCreates: Array<{ id: string; clientKey: string; data: DestinationFields }> = [];
  const destinationUpdates: Array<{ id: string; data: DestinationFields }> = [];
  const resolvedDestinationId = new Map<string, string>();
  const seenExistingDestIds = new Set<string>();

  for (const d of destinationsInput) {
    if (d.id) {
      if (!existingDestIds.has(d.id)) throw HttpError.badRequest(`Destination ${d.id} does not belong to this dispatch order`);
      if (seenExistingDestIds.has(d.id)) throw HttpError.badRequest(`Destination ${d.id} referenced more than once`);
      seenExistingDestIds.add(d.id);
      destinationUpdates.push({ id: d.id, data: toDestinationFields(d) });
      resolvedDestinationId.set(d.clientKey, d.id);
    } else {
      const newId = createId();
      destinationCreates.push({ id: newId, clientKey: d.clientKey, data: toDestinationFields(d) });
      resolvedDestinationId.set(d.clientKey, newId);
    }
  }
  const destinationDeleteIds = [...existingDestIds].filter((id) => !seenExistingDestIds.has(id));

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
    lineCreates,
    lineFieldUpdates: [] as Array<{ id: string; destinationId: string; styleId: string; sizeId: string; quantity: number }>,
    lineDeleteIds: [] as string[],
    lineMerges: [] as Array<{ losingId: string; survivingId: string }>,
  };
}

// The full surgical reconciliation planner (no factory change) — see the
// Phase 3 plan §2.3 Phase B. Validates line/destination identity, computes
// packed-floor rejections, resolves destination moves and style/size
// changes on unpacked lines, detects and merges 2-way collisions, and
// produces the destination/line write plan plus the per-pool-key additional
// demand needed.
function resolveDesiredLinesForReconciliation(
  existingDestinations: Array<{ id: string }>,
  existingLines: LoadedLine[],
  destinationsInput: DispatchOrderDestinationInput[],
  linesInput: DispatchOrderLineInput[],
  packedByAllocation: Map<string, number>,
  factoryDispatchLinesByAllocation: Map<string, string[]>,
) {
  const packedForAllocation = (allocationId: string): number => packedByAllocation.get(allocationId) ?? 0;
  const packedForLine = (line: LoadedLine): number =>
    line.allocations.reduce((sum, a) => sum + packedForAllocation(a.id), 0);
  const existingDestIds = new Set(existingDestinations.map((d) => d.id));
  const existingLineById = new Map(existingLines.map((l) => [l.id, l]));

  // --- Destinations ---
  const destinationCreates: Array<{ id: string; clientKey: string; data: DestinationFields }> = [];
  const destinationUpdates: Array<{ id: string; data: DestinationFields }> = [];
  const resolvedDestinationId = new Map<string, string>();
  const seenExistingDestIds = new Set<string>();

  for (const d of destinationsInput) {
    if (d.id) {
      if (!existingDestIds.has(d.id)) throw HttpError.badRequest(`Destination ${d.id} does not belong to this dispatch order`);
      if (seenExistingDestIds.has(d.id)) throw HttpError.badRequest(`Destination ${d.id} referenced more than once`);
      seenExistingDestIds.add(d.id);
      destinationUpdates.push({ id: d.id, data: toDestinationFields(d) });
      resolvedDestinationId.set(d.clientKey, d.id);
    } else {
      const newId = createId();
      destinationCreates.push({ id: newId, clientKey: d.clientKey, data: toDestinationFields(d) });
      resolvedDestinationId.set(d.clientKey, newId);
    }
  }
  const destinationDeleteCandidateIds = [...existingDestIds].filter((id) => !seenExistingDestIds.has(id));

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
