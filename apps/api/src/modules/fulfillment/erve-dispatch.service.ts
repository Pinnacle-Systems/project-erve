import { createId } from '@erve/shared';
import { canMutateErveDispatch, canViewErveDispatch, canViewErvePackingList } from '@erve/shared';
import { Prisma, prisma } from '../../db/prisma.js';
import { getSoleDistributorId } from '../../auth/access.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import { ensureFinancialYear } from '../master-data/financial-year.service.js';
import { allocateDocumentSerial } from '../master-data/document-sequence.service.js';
import { DOCUMENT_PREFIXES, formatDocumentNumber } from '../master-data/document-number.util.js';
import { createInvoiceHandoffsForDispatch } from './invoice-handoff.service.js';
import {
  computeAvailability,
  getActualSoldQuantityForPair,
  getApprovedAwaitingReceiptQuantityForPair,
  getPendingRequestedQuantityForPair,
  getReceivedQuantityForPair,
  getReturnedQuantityForPair,
} from './sale-or-return-quantities.js';

type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Access helpers
// ---------------------------------------------------------------------------

function assertPackingListMutationAccess(actor: CurrentUser): void {
  if (!canMutateErveDispatch(actor)) {
    throw HttpError.forbidden('You do not have permission to consolidate Factory Packing Cartons');
  }
}

function assertPackingListViewAccess(actor: CurrentUser): void {
  if (!canViewErvePackingList(actor)) {
    throw HttpError.forbidden('You do not have permission to view Erve Packing Lists');
  }
}

function assertDispatchMutationAccess(actor: CurrentUser): void {
  if (!canMutateErveDispatch(actor)) {
    throw HttpError.forbidden('You do not have permission to record Erve Dispatches');
  }
}

// Sees every Distributor's Erve Dispatches (no per-row ownership check),
// mirroring canListAllSaleOrders — ACCOUNTANT included since this view is
// already sanitized (no Factory/QA/StockAllocation provenance, see
// ErveDispatchView) unlike the Erve Packing List detail above.
function isBroadErveDispatchViewer(actor: CurrentUser): boolean {
  return actor.roles.some((r) => r === 'ADMIN' || r === 'MERCHANDISER' || r === 'SENIOR_MANAGEMENT' || r === 'ACCOUNTANT');
}

function assertDispatchViewAccess(actor: CurrentUser, distributorId: string): void {
  if (!canViewErveDispatch(actor)) {
    throw HttpError.forbidden('You do not have permission to view Erve Dispatches');
  }
  if (!isBroadErveDispatchViewer(actor) && getSoleDistributorId(actor) !== distributorId) {
    throw HttpError.forbidden('You do not have access to this dispatch');
  }
}

// ---------------------------------------------------------------------------
// Document numbering
// ---------------------------------------------------------------------------

async function generateErvePackingListNumber(client: Tx, financialYear: { id: string; code: string }) {
  const serial = await allocateDocumentSerial(client, 'ERVE_PACKING_LIST', financialYear.id);
  return {
    ervePackingListNumber: formatDocumentNumber(DOCUMENT_PREFIXES.ERVE_PACKING_LIST, financialYear.code, serial),
    ervePackingListSerial: serial,
  };
}

async function generateErveDispatchNumber(client: Tx, financialYear: { id: string; code: string }) {
  const serial = await allocateDocumentSerial(client, 'ERVE_DISPATCH', financialYear.id);
  return {
    erveDispatchNumber: formatDocumentNumber(DOCUMENT_PREFIXES.ERVE_DISPATCH, financialYear.code, serial),
    erveDispatchSerial: serial,
  };
}

// ---------------------------------------------------------------------------
// Destination identity (Phase 6 plan §6/§15) — normalized on the structured
// physical-location fields only (never the free-text `label`), so two
// SaleOrderDestination rows from DIFFERENT Dispatch Orders that describe the
// same real-world address compare equal, while still never being confused
// with a display string. This is deliberately NOT a comparison of live
// SaleOrderDestination row identity — every Dispatch Order owns its own
// destination rows even for an identical physical address, so ID equality
// would make the required cross-Dispatch-Order consolidation impossible.
// Matching a "same destination" never implies "same Distributor" — that is
// enforced as a fully independent, non-negotiable check everywhere this key
// is used (see assertSameCommercialOwner).
// ---------------------------------------------------------------------------

interface DestinationAddressFields {
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  country: string;
  postalCode: string | null;
}

function normalizeAddressField(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function destinationMatchKeyOf(destination: DestinationAddressFields): string {
  return [
    normalizeAddressField(destination.addressLine1),
    normalizeAddressField(destination.addressLine2),
    normalizeAddressField(destination.city),
    normalizeAddressField(destination.state),
    normalizeAddressField(destination.country),
    normalizeAddressField(destination.postalCode),
  ].join('|');
}

// ---------------------------------------------------------------------------
// Carton eligibility (Phase 6 plan §5) — a carton may be selected into an
// Erve Packing List only while all of these hold. This is re-checked both at
// selection time (createErvePackingList/addErvePackingListCartons) and again
// at finalize time (finalizeErvePackingList), since finalize is the last
// point before carton membership becomes immutable.
// ---------------------------------------------------------------------------

// Correction 8: a carton's commercial owner (Distributor) is resolved via
// its destination's Distributor-group, not via a single order-root value —
// one Dispatch Order may now span multiple Distributors, so
// `factoryDispatch.saleOrder.distributorId` no longer exists and would be
// wrong even if it did.
const eligibilityCartonInclude = {
  destination: {
    include: {
      saleOrderDistributor: { include: { distributor: { select: { id: true, code: true, name: true } } } },
    },
  },
  factoryDispatch: {
    select: {
      id: true,
      factoryDispatchNumber: true,
      status: true,
      factory: { select: { id: true, code: true, name: true } },
      saleOrder: { select: { id: true, saleOrderNumber: true } },
    },
  },
  lines: { include: { saleOrderLine: { select: { style: { select: { id: true, styleNumber: true, styleName: true } }, size: { select: { id: true, code: true, label: true } } } } } },
  audits: { orderBy: { cartonVersion: 'desc' as const }, take: 1 },
} satisfies Prisma.FactoryPackingCartonInclude;

type EligibilityCarton = Prisma.FactoryPackingCartonGetPayload<{ include: typeof eligibilityCartonInclude }>;

function assertCartonEligibleForConsolidation(carton: EligibilityCarton): void {
  if (carton.retiredAt) {
    throw HttpError.badRequest(`Carton ${carton.cartonNumber} has been retired and is no longer eligible for Erve consolidation`);
  }
  if (carton.factoryDispatch.status !== 'READY_FOR_ERVE') {
    throw HttpError.badRequest(`Carton ${carton.cartonNumber}'s Factory Packing List must be finalized (READY_FOR_ERVE) before Erve consolidation`);
  }
  if (carton.lines.length === 0) {
    throw HttpError.badRequest(`Carton ${carton.cartonNumber} has no packed contents`);
  }
  const currentAudit = carton.audits[0];
  if (!currentAudit || currentAudit.cartonVersion !== carton.version) {
    throw HttpError.badRequest(`Carton ${carton.cartonNumber} does not have a current Packing Audit`);
  }
}

function assertSameCommercialOwner(carton: EligibilityCarton, distributorId: string, cartonMatchKey: string, ervePackingListMatchKey: string): void {
  if (cartonMatchKey !== ervePackingListMatchKey) {
    throw HttpError.badRequest(`Carton ${carton.cartonNumber} has a different destination than the other selected cartons`);
  }
  if (carton.destination.saleOrderDistributor.distributorId !== distributorId) {
    // Phase 6 plan §15: a matching physical address never implies a matching
    // Distributor. This boundary is intentionally NOT relaxed here — combining
    // cartons for different billing Distributors is a deferred Tax Invoice/
    // statutory decision, not something this phase may invent. Correction 8:
    // the commercial owner is resolved from the carton's own destination's
    // Distributor-group — a single Dispatch Order may now contain cartons
    // whose destinations belong to different Distributors, so this can no
    // longer be read off the order root.
    throw HttpError.conflict(
      `Carton ${carton.cartonNumber} belongs to a different Distributor — cartons for different Distributors cannot be combined into one Erve Dispatch`,
    );
  }
}

function toEligibleCartonView(carton: EligibilityCarton) {
  const totalQuantity = carton.lines.reduce((sum, line) => sum + line.quantity, 0);
  return {
    id: carton.id,
    cartonNumber: carton.cartonNumber,
    factory: carton.factoryDispatch.factory,
    factoryDispatchId: carton.factoryDispatch.id,
    factoryDispatchNumber: carton.factoryDispatch.factoryDispatchNumber,
    saleOrder: carton.factoryDispatch.saleOrder,
    distributor: carton.destination.saleOrderDistributor.distributor,
    destination: {
      id: carton.destination.id,
      label: carton.destination.label,
      city: carton.destination.city,
      state: carton.destination.state,
    },
    packageDetails: carton.packageDetails,
    weight: carton.weight?.toString() ?? null,
    totalQuantity,
    lines: carton.lines.map((line) => ({
      saleOrderLineId: line.saleOrderLineId,
      styleNumber: line.saleOrderLine.style.styleNumber,
      styleName: line.saleOrderLine.style.styleName,
      sizeCode: line.saleOrderLine.size.code,
      sizeLabel: line.saleOrderLine.size.label,
      quantity: line.quantity,
    })),
  };
}

export async function getEligibleErveCartons(actor: CurrentUser, filters: { ervePackingListId?: string }) {
  assertPackingListMutationAccess(actor);

  let matchKey: string | undefined;
  let distributorId: string | undefined;
  if (filters.ervePackingListId) {
    const packingList = await prisma.ervePackingList.findUnique({
      where: { id: filters.ervePackingListId },
      select: { status: true, destinationMatchKey: true, distributorId: true },
    });
    if (!packingList) throw HttpError.notFound('Erve packing list not found');
    if (packingList.status !== 'OPEN') {
      throw HttpError.conflict('This Erve Packing List is no longer open for carton selection');
    }
    matchKey = packingList.destinationMatchKey ?? undefined;
    distributorId = packingList.distributorId ?? undefined;
  }

  const cartons = await prisma.factoryPackingCarton.findMany({
    where: { retiredAt: null, ervePackingListId: null, factoryDispatch: { status: 'READY_FOR_ERVE' } },
    include: eligibilityCartonInclude,
    orderBy: { createdAt: 'asc' },
  });

  const eligible = cartons.filter((carton) => {
    if (carton.lines.length === 0) return false;
    const currentAudit = carton.audits[0];
    if (!currentAudit || currentAudit.cartonVersion !== carton.version) return false;
    if (distributorId && carton.destination.saleOrderDistributor.distributorId !== distributorId) return false;
    if (matchKey && destinationMatchKeyOf(carton.destination) !== matchKey) return false;
    return true;
  });

  return eligible.map(toEligibleCartonView);
}

// ---------------------------------------------------------------------------
// Erve Packing List — carton-based consolidation (Phase 6)
// ---------------------------------------------------------------------------

const packingListInclude = {
  distributor: { select: { id: true, code: true, name: true } },
  saleOrder: { select: { id: true, saleOrderNumber: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  finalizedBy: { select: { id: true, name: true, email: true } },
  dispatch: { select: { id: true, erveDispatchNumber: true, status: true } },
  // Retired cartons are immutable historical records — never part of the
  // current, consolidated Erve view (Phase 4 plan §4/§9).
  cartons: {
    where: { retiredAt: null },
    include: {
      factoryDispatch: {
        select: {
          id: true,
          factoryDispatchNumber: true,
          factory: { select: { id: true, code: true, name: true } },
          saleOrder: { select: { id: true, saleOrderNumber: true } },
        },
      },
      lines: {
        include: {
          saleOrderLine: {
            select: {
              style: { select: { id: true, styleNumber: true, styleName: true } },
              size: { select: { id: true, code: true, label: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ErvePackingListInclude;

type PackingListRecord = Prisma.ErvePackingListGetPayload<{ include: typeof packingListInclude }>;

function toPackingListCartonView(carton: PackingListRecord['cartons'][number]) {
  const totalQuantity = carton.lines.reduce((sum, line) => sum + line.quantity, 0);
  return {
    id: carton.id,
    cartonNumber: carton.cartonNumber,
    factory: carton.factoryDispatch.factory,
    factoryDispatchId: carton.factoryDispatch.id,
    factoryDispatchNumber: carton.factoryDispatch.factoryDispatchNumber,
    saleOrder: carton.factoryDispatch.saleOrder,
    packageDetails: carton.packageDetails,
    weight: carton.weight?.toString() ?? null,
    totalQuantity,
    lines: carton.lines.map((line) => ({
      saleOrderLineId: line.saleOrderLineId,
      styleNumber: line.saleOrderLine.style.styleNumber,
      styleName: line.saleOrderLine.style.styleName,
      sizeCode: line.saleOrderLine.size.code,
      sizeLabel: line.saleOrderLine.size.label,
      quantity: line.quantity,
    })),
  };
}

function toStyleSizeSummary(record: PackingListRecord) {
  const byKey = new Map<string, { styleNumber: string; styleName: string; sizeCode: string; sizeLabel: string; quantity: number }>();
  for (const carton of record.cartons) {
    for (const line of carton.lines) {
      const key = `${line.saleOrderLine.style.id}:${line.saleOrderLine.size.id}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.quantity += line.quantity;
      } else {
        byKey.set(key, {
          styleNumber: line.saleOrderLine.style.styleNumber,
          styleName: line.saleOrderLine.style.styleName,
          sizeCode: line.saleOrderLine.size.code,
          sizeLabel: line.saleOrderLine.size.label,
          quantity: line.quantity,
        });
      }
    }
  }
  return [...byKey.values()];
}

function totalQuantityOf(record: PackingListRecord): number {
  return record.cartons.reduce((sum, carton) => sum + carton.lines.reduce((lineSum, line) => lineSum + line.quantity, 0), 0);
}

function sourceFactoriesOf(record: PackingListRecord) {
  const byId = new Map<string, { id: string; code: string; name: string }>();
  for (const carton of record.cartons) byId.set(carton.factoryDispatch.factory.id, carton.factoryDispatch.factory);
  return [...byId.values()];
}

function sourceDispatchOrdersOf(record: PackingListRecord) {
  const byId = new Map<string, { id: string; saleOrderNumber: string }>();
  for (const carton of record.cartons) byId.set(carton.factoryDispatch.saleOrder.id, carton.factoryDispatch.saleOrder);
  return [...byId.values()];
}

function destinationSnapshotOf(record: PackingListRecord) {
  return {
    label: record.destinationLabel,
    contactName: record.destinationContactName,
    contactEmail: record.destinationContactEmail,
    contactPhone: record.destinationContactPhone,
    addressLine1: record.destinationAddressLine1,
    addressLine2: record.destinationAddressLine2,
    city: record.destinationCity,
    state: record.destinationState,
    country: record.destinationCountry,
    postalCode: record.destinationPostalCode,
  };
}

function toPackingListSummary(record: PackingListRecord) {
  return {
    id: record.id,
    ervePackingListNumber: record.ervePackingListNumber,
    distributor: record.distributor,
    saleOrder: record.saleOrder,
    destination: destinationSnapshotOf(record),
    status: record.status,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    cartonCount: record.cartons.length,
    totalQuantity: totalQuantityOf(record),
    sourceFactories: sourceFactoriesOf(record),
    sourceDispatchOrders: sourceDispatchOrdersOf(record),
    dispatch: record.dispatch,
  };
}

function toPackingListDetail(record: PackingListRecord) {
  return {
    ...toPackingListSummary(record),
    finalizedBy: record.finalizedBy,
    finalizedAt: record.finalizedAt?.toISOString() ?? null,
    cartons: record.cartons.map(toPackingListCartonView),
    styleSizeSummary: toStyleSizeSummary(record),
  };
}

async function loadPackingList(id: string): Promise<PackingListRecord> {
  const record = await prisma.ervePackingList.findUnique({ where: { id }, include: packingListInclude });
  if (!record) throw HttpError.notFound('Erve packing list not found');
  return record;
}

export async function getErvePackingListDetail(actor: CurrentUser, id: string) {
  assertPackingListViewAccess(actor);
  return toPackingListDetail(await loadPackingList(id));
}

export async function getErvePackingListList(
  actor: CurrentUser,
  filters: { saleOrderId?: string; distributorId?: string; status?: 'OPEN' | 'FINALIZED' | 'DISPATCHED'; cursor?: string; limit: number },
) {
  assertPackingListViewAccess(actor);
  const records = await prisma.ervePackingList.findMany({
    where: { saleOrderId: filters.saleOrderId, distributorId: filters.distributorId, status: filters.status },
    include: packingListInclude,
    orderBy: { id: 'desc' },
    take: filters.limit + 1,
    cursor: filters.cursor ? { id: filters.cursor } : undefined,
    skip: filters.cursor ? 1 : undefined,
  });
  const hasMore = records.length > filters.limit;
  const page = hasMore ? records.slice(0, filters.limit) : records;
  return {
    items: page.map(toPackingListSummary),
    pageInfo: { limit: filters.limit, hasMore, nextCursor: hasMore ? page.at(-1)!.id : null },
  };
}

// Claims a single carton for this Erve Packing List with a WHERE-guarded
// UPDATE — Postgres serializes concurrent UPDATEs against the same row, so
// this is race-safe against another concurrent claim without a separate
// advisory lock per carton (Phase 6 plan §20). Deliberately does not bump
// `version` — assigning to an Erve Packing List is not a material-content
// change (see FactoryPackingCarton's doc comment).
async function claimCartonForPackingList(tx: Tx, cartonId: string, ervePackingListId: string, cartonNumber: string): Promise<void> {
  const updated = await tx.factoryPackingCarton.updateMany({
    where: { id: cartonId, ervePackingListId: null },
    data: { ervePackingListId },
  });
  if (updated.count !== 1) {
    throw HttpError.conflict(`Carton ${cartonNumber} has already been assigned to another Erve Dispatch`);
  }
}

async function loadAndValidateCartonsForConsolidation(
  tx: Tx,
  cartonIds: string[],
  existing: { destinationMatchKey: string; distributorId: string } | null,
): Promise<{
  cartons: EligibilityCarton[];
  distributorId: string;
  matchKey: string;
  originDestinationId: string;
  destinationSnapshot: DestinationAddressFields & { label: string | null; contactName: string | null; contactEmail: string | null; contactPhone: string | null };
  saleOrderIds: Set<string>;
}> {
  const cartons = await tx.factoryPackingCarton.findMany({ where: { id: { in: cartonIds } }, include: eligibilityCartonInclude });
  const cartonById = new Map(cartons.map((c) => [c.id, c]));

  let distributorId = existing?.distributorId ?? null;
  let matchKey = existing?.destinationMatchKey ?? null;
  let originDestinationId: string | null = null;
  let destinationSnapshot: (DestinationAddressFields & { label: string | null; contactName: string | null; contactEmail: string | null; contactPhone: string | null }) | null = null;
  const saleOrderIds = new Set<string>();

  const orderedCartons: EligibilityCarton[] = [];
  for (const id of cartonIds) {
    const carton = cartonById.get(id);
    if (!carton) throw HttpError.notFound(`Carton ${id} not found`);
    if (carton.ervePackingListId) {
      throw HttpError.conflict(`Carton ${carton.cartonNumber} has already been assigned to another Erve Dispatch`);
    }
    assertCartonEligibleForConsolidation(carton);

    const cartonKey = destinationMatchKeyOf(carton.destination);
    const cartonDistributorId = carton.destination.saleOrderDistributor.distributorId;
    if (distributorId === null || matchKey === null) {
      distributorId = cartonDistributorId;
      matchKey = cartonKey;
      originDestinationId = carton.destinationId;
      destinationSnapshot = {
        label: carton.destination.label,
        contactName: carton.destination.contactName,
        contactEmail: carton.destination.contactEmail,
        contactPhone: carton.destination.contactPhone,
        addressLine1: carton.destination.addressLine1,
        addressLine2: carton.destination.addressLine2,
        city: carton.destination.city,
        state: carton.destination.state,
        country: carton.destination.country,
        postalCode: carton.destination.postalCode,
      };
    } else {
      assertSameCommercialOwner(carton, distributorId, cartonKey, matchKey);
    }
    saleOrderIds.add(carton.factoryDispatch.saleOrder.id);
    orderedCartons.push(carton);
  }

  if (distributorId === null || matchKey === null) {
    throw HttpError.badRequest('At least one carton is required');
  }
  // destinationSnapshot/originDestinationId are only populated by the FIRST
  // carton of a brand-new consolidation (existing === null) — the add-to-
  // existing path (existing !== null) never needs them, since the Erve
  // Packing List's destination snapshot was already set at creation.
  if (existing === null && !destinationSnapshot) {
    throw HttpError.badRequest('At least one carton is required');
  }
  return {
    cartons: orderedCartons,
    distributorId,
    matchKey,
    originDestinationId: originDestinationId ?? '',
    destinationSnapshot: destinationSnapshot ?? ({} as DestinationAddressFields & { label: string | null; contactName: string | null; contactEmail: string | null; contactPhone: string | null }),
    saleOrderIds,
  };
}

export interface CreateErvePackingListInput {
  cartonIds: string[];
}

export async function createErvePackingList(actor: CurrentUser, input: CreateErvePackingListInput) {
  assertPackingListMutationAccess(actor);

  const cartonIds = [...new Set(input.cartonIds)];
  if (cartonIds.length !== input.cartonIds.length) {
    throw HttpError.badRequest('Duplicate carton entries are not allowed');
  }

  const packingListId = createId();
  await prisma.$transaction(async (tx) => {
    const sortedCartonIds = [...cartonIds].sort();
    for (const id of sortedCartonIds) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`factory-packing-carton-${id}`}))`;
    }

    const { distributorId, matchKey, originDestinationId, destinationSnapshot, saleOrderIds } = await loadAndValidateCartonsForConsolidation(tx, cartonIds, null);

    const financialYear = await ensureFinancialYear(tx, new Date());
    const { ervePackingListNumber, ervePackingListSerial } = await generateErvePackingListNumber(tx, financialYear);

    await tx.ervePackingList.create({
      data: {
        id: packingListId,
        ervePackingListNumber,
        status: 'OPEN',
        createdById: actor.id,
        // Legacy-compatibility single-order fact (see the model doc) — only
        // meaningful while every selected carton still traces to the SAME
        // Dispatch Order; left null the moment a second one is introduced,
        // here or via addErvePackingListCartons.
        saleOrderId: saleOrderIds.size === 1 ? [...saleOrderIds][0] : null,
        distributorId,
        originDestinationId,
        destinationMatchKey: matchKey,
        destinationLabel: destinationSnapshot.label,
        destinationContactName: destinationSnapshot.contactName,
        destinationContactEmail: destinationSnapshot.contactEmail,
        destinationContactPhone: destinationSnapshot.contactPhone,
        destinationAddressLine1: destinationSnapshot.addressLine1,
        destinationAddressLine2: destinationSnapshot.addressLine2,
        destinationCity: destinationSnapshot.city,
        destinationState: destinationSnapshot.state,
        destinationCountry: destinationSnapshot.country,
        destinationPostalCode: destinationSnapshot.postalCode,
        financialYearId: financialYear.id,
        ervePackingListSerial,
      },
    });

    for (const id of cartonIds) {
      const carton = (await tx.factoryPackingCarton.findUnique({ where: { id }, select: { cartonNumber: true } }))!;
      await claimCartonForPackingList(tx, id, packingListId, carton.cartonNumber);
    }

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'ERVE_PACKING_LIST_CREATED',
        entityType: 'ErvePackingList',
        entityId: packingListId,
        metadata: { ervePackingListNumber, cartonIds, distributorId, destinationMatchKey: matchKey },
      },
      tx,
    );
  });

  return getErvePackingListDetail(actor, packingListId);
}

export async function addErvePackingListCartons(actor: CurrentUser, ervePackingListId: string, cartonIds: string[]) {
  assertPackingListMutationAccess(actor);

  const uniqueCartonIds = [...new Set(cartonIds)];
  if (uniqueCartonIds.length !== cartonIds.length) {
    throw HttpError.badRequest('Duplicate carton entries are not allowed');
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`erve-packing-list-${ervePackingListId}`}))`;

    const packingList = await tx.ervePackingList.findUnique({ where: { id: ervePackingListId } });
    if (!packingList) throw HttpError.notFound('Erve packing list not found');
    if (packingList.status !== 'OPEN') {
      throw HttpError.conflict('Cartons can only be added while the Erve Packing List is open');
    }

    const sortedCartonIds = [...uniqueCartonIds].sort();
    for (const id of sortedCartonIds) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`factory-packing-carton-${id}`}))`;
    }

    if (!packingList.destinationMatchKey || !packingList.distributorId) {
      throw HttpError.conflict('This Erve Packing List has no established destination');
    }
    const { saleOrderIds: newSaleOrderIds } = await loadAndValidateCartonsForConsolidation(tx, uniqueCartonIds, {
      destinationMatchKey: packingList.destinationMatchKey,
      distributorId: packingList.distributorId,
    });

    // Demote the legacy-compatibility single-order fact to null the moment a
    // second Dispatch Order joins the consolidation (see the model doc).
    if (packingList.saleOrderId && (newSaleOrderIds.size > 1 || !newSaleOrderIds.has(packingList.saleOrderId))) {
      await tx.ervePackingList.update({ where: { id: ervePackingListId }, data: { saleOrderId: null } });
    }

    for (const id of uniqueCartonIds) {
      const carton = (await tx.factoryPackingCarton.findUnique({ where: { id }, select: { cartonNumber: true } }))!;
      await claimCartonForPackingList(tx, id, ervePackingListId, carton.cartonNumber);
      await recordAuditLog(
        {
          actorId: actor.id,
          action: 'ERVE_PACKING_LIST_CARTON_ADDED',
          entityType: 'ErvePackingList',
          entityId: ervePackingListId,
          metadata: { ervePackingListNumber: packingList.ervePackingListNumber, cartonId: id, cartonNumber: carton.cartonNumber },
        },
        tx,
      );
    }
  });

  return getErvePackingListDetail(actor, ervePackingListId);
}

export async function removeErvePackingListCarton(actor: CurrentUser, ervePackingListId: string, cartonId: string) {
  assertPackingListMutationAccess(actor);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`erve-packing-list-${ervePackingListId}`}))`;

    const packingList = await tx.ervePackingList.findUnique({ where: { id: ervePackingListId } });
    if (!packingList) throw HttpError.notFound('Erve packing list not found');
    if (packingList.status !== 'OPEN') {
      throw HttpError.conflict('Cartons can only be removed while the Erve Packing List is open');
    }

    const carton = await tx.factoryPackingCarton.findUnique({ where: { id: cartonId }, select: { cartonNumber: true, ervePackingListId: true } });
    if (!carton || carton.ervePackingListId !== ervePackingListId) {
      throw HttpError.notFound('This carton is not on this Erve Packing List');
    }

    await tx.factoryPackingCarton.update({ where: { id: cartonId }, data: { ervePackingListId: null } });

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'ERVE_PACKING_LIST_CARTON_REMOVED',
        entityType: 'ErvePackingList',
        entityId: ervePackingListId,
        metadata: { ervePackingListNumber: packingList.ervePackingListNumber, cartonId, cartonNumber: carton.cartonNumber },
      },
      tx,
    );
  });

  return getErvePackingListDetail(actor, ervePackingListId);
}

export async function finalizeErvePackingList(actor: CurrentUser, ervePackingListId: string) {
  assertPackingListMutationAccess(actor);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`erve-packing-list-${ervePackingListId}`}))`;

    const packingList = await tx.ervePackingList.findUnique({
      where: { id: ervePackingListId },
      include: { cartons: { where: { retiredAt: null }, include: eligibilityCartonInclude } },
    });
    if (!packingList) throw HttpError.notFound('Erve packing list not found');
    if (packingList.status !== 'OPEN') {
      throw HttpError.conflict('This Erve Packing List has already been finalized');
    }
    if (packingList.cartons.length === 0) {
      throw HttpError.badRequest('At least one carton must be selected before finalizing');
    }
    // Re-validate every carton is still current — guards against a concurrent
    // change (e.g. a stale audit) landing between selection and finalize.
    for (const carton of packingList.cartons) {
      assertCartonEligibleForConsolidation(carton);
    }

    await tx.ervePackingList.update({
      where: { id: ervePackingListId },
      data: { status: 'FINALIZED', finalizedById: actor.id, finalizedAt: new Date() },
    });

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'ERVE_PACKING_LIST_FINALIZED',
        entityType: 'ErvePackingList',
        entityId: ervePackingListId,
        metadata: { ervePackingListNumber: packingList.ervePackingListNumber, cartonCount: packingList.cartons.length },
      },
      tx,
    );
  });

  return getErvePackingListDetail(actor, ervePackingListId);
}

// ---------------------------------------------------------------------------
// Erve Dispatch — physical dispatch to Distributor
// ---------------------------------------------------------------------------

const erveDispatchInclude = {
  ervePackingList: { select: { id: true, ervePackingListNumber: true } },
  saleOrder: { select: { id: true, saleOrderNumber: true } },
  distributor: { select: { id: true, code: true, name: true } },
  dispatchedBy: { select: { id: true, name: true, email: true } },
  lrUpdatedBy: { select: { id: true, name: true, email: true } },
  deliveredBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.ErveDispatchInclude;

type ErveDispatchRecord = Prisma.ErveDispatchGetPayload<{ include: typeof erveDispatchInclude }>;

// Physical dispatch quantity authority (Phase 6 plan §14): the sum of
// FactoryPackingCartonLine.quantity across the cartons that were members of
// this Erve Packing List — never FactoryDispatchLine, which may cover cartons
// bound for other destinations/Erve Packing Lists entirely.
async function computePackingListQuantity(client: Tx | typeof prisma, ervePackingListId: string): Promise<number> {
  const rows = await client.factoryPackingCartonLine.findMany({
    where: { carton: { ervePackingListId, retiredAt: null } },
    select: { quantity: true },
  });
  return rows.reduce((sum, row) => sum + row.quantity, 0);
}

// Breaks this Dispatch's carton-derived quantity down per SaleOrderLine and
// resolves each line's COMMERCIAL PurchaseMode (never StockAllocation/
// QaReleaseLine physical provenance — see invoice-handoff.service.ts) purely
// for display context. EVERY line — both Purchase Modes — already has an
// auto-created InvoiceHandoff (the "Dispatch Sale"); SALE_RETURN lines
// additionally get a consignment-position entry (dispatched/actual sold/
// remaining) so a mixed-mode Dispatch shows both the invoice status and,
// where relevant, the Sale-or-Return position without a second navigation.
async function computeDispatchFinancialBreakdown(erveDispatchId: string, ervePackingListId: string) {
  const lines = await prisma.factoryPackingCartonLine.findMany({
    where: { carton: { ervePackingListId, retiredAt: null } },
    select: {
      saleOrderLineId: true,
      quantity: true,
      saleOrderLine: {
        select: {
          style: { select: { styleNumber: true, styleName: true } },
          size: { select: { code: true, label: true } },
          // Correction 8: purchaseMode is resolved per line via its own
          // destination's Distributor-group snapshot, not a single
          // order-level value — a Dispatch Order may mix Distributors/
          // Purchase Modes.
          destination: { select: { saleOrderDistributor: { select: { purchaseMode: true } } } },
        },
      },
    },
  });

  type LineMeta = {
    quantity: number;
    purchaseMode: 'OUTRIGHT' | 'SALE_RETURN';
    styleNumber: string;
    styleName: string;
    sizeCode: string;
    sizeLabel: string;
  };
  const bySaleOrderLine = new Map<string, LineMeta>();
  for (const line of lines) {
    const sol = line.saleOrderLine;
    const existing = bySaleOrderLine.get(line.saleOrderLineId);
    if (existing) {
      existing.quantity += line.quantity;
      continue;
    }
    bySaleOrderLine.set(line.saleOrderLineId, {
      quantity: line.quantity,
      purchaseMode: sol.destination.saleOrderDistributor.purchaseMode,
      styleNumber: sol.style.styleNumber,
      styleName: sol.style.styleName,
      sizeCode: sol.size.code,
      sizeLabel: sol.size.label,
    });
  }

  const invoiceHandoffs: Array<{
    invoiceHandoffId: string;
    saleOrderLineId: string;
    purchaseMode: 'OUTRIGHT' | 'SALE_RETURN';
    styleNumber: string;
    styleName: string;
    sizeCode: string;
    sizeLabel: string;
    quantity: number;
    status: 'PENDING_TALLY' | 'INVOICED';
    tallyInvoiceNumber: string | null;
    tallyInvoiceDate: string | null;
  }> = [];
  if (bySaleOrderLine.size > 0) {
    const handoffs = await prisma.invoiceHandoff.findMany({
      where: { erveDispatchId, saleOrderLineId: { in: [...bySaleOrderLine.keys()] } },
      select: { id: true, saleOrderLineId: true, status: true, tallyInvoiceNumber: true, tallyInvoiceDate: true },
    });
    for (const handoff of handoffs) {
      const meta = bySaleOrderLine.get(handoff.saleOrderLineId)!;
      invoiceHandoffs.push({
        invoiceHandoffId: handoff.id,
        saleOrderLineId: handoff.saleOrderLineId,
        purchaseMode: meta.purchaseMode,
        styleNumber: meta.styleNumber,
        styleName: meta.styleName,
        sizeCode: meta.sizeCode,
        sizeLabel: meta.sizeLabel,
        quantity: meta.quantity,
        status: handoff.status,
        tallyInvoiceNumber: handoff.tallyInvoiceNumber,
        tallyInvoiceDate: handoff.tallyInvoiceDate?.toISOString() ?? null,
      });
    }
  }

  const saleReturnSaleOrderLineIds = [...bySaleOrderLine.entries()].filter(([, meta]) => meta.purchaseMode === 'SALE_RETURN').map(([id]) => id);
  const saleOrReturnLines: Array<{
    saleOrderLineId: string;
    styleNumber: string;
    styleName: string;
    sizeCode: string;
    sizeLabel: string;
    dispatchedQuantity: number;
    receivedQuantity: number;
    actualSoldQuantity: number;
    returnedQuantity: number;
    approvedAwaitingReceiptQuantity: number;
    pendingRequestedQuantity: number;
    remainingWithDistributor: number;
    returnableQuantity: number;
  }> = [];
  for (const saleOrderLineId of saleReturnSaleOrderLineIds) {
    const meta = bySaleOrderLine.get(saleOrderLineId)!;
    const [receivedQuantity, actualSoldQuantity, returnedQuantity, approvedAwaitingReceiptQuantity, pendingRequestedQuantity] =
      await Promise.all([
        getReceivedQuantityForPair(prisma, erveDispatchId, saleOrderLineId),
        getActualSoldQuantityForPair(prisma, erveDispatchId, saleOrderLineId),
        getReturnedQuantityForPair(prisma, erveDispatchId, saleOrderLineId),
        getApprovedAwaitingReceiptQuantityForPair(prisma, erveDispatchId, saleOrderLineId),
        getPendingRequestedQuantityForPair(prisma, erveDispatchId, saleOrderLineId),
      ]);
    const availability = computeAvailability({
      receivedQuantity,
      actualSoldQuantity,
      returnedQuantity,
      approvedAwaitingReceiptQuantity,
      pendingRequestedQuantity,
    });
    saleOrReturnLines.push({
      saleOrderLineId,
      styleNumber: meta.styleNumber,
      styleName: meta.styleName,
      sizeCode: meta.sizeCode,
      sizeLabel: meta.sizeLabel,
      dispatchedQuantity: meta.quantity,
      receivedQuantity,
      actualSoldQuantity,
      returnedQuantity,
      approvedAwaitingReceiptQuantity,
      pendingRequestedQuantity,
      remainingWithDistributor: availability.remainingWithDistributor,
      returnableQuantity: availability.availableForNewReturn,
    });
  }

  return { invoiceHandoffs, saleOrReturnLines };
}

async function toErveDispatchView(record: ErveDispatchRecord) {
  const totalQuantity = await computePackingListQuantity(prisma, record.ervePackingListId);
  const { invoiceHandoffs, saleOrReturnLines } = await computeDispatchFinancialBreakdown(record.id, record.ervePackingListId);
  return {
    id: record.id,
    erveDispatchNumber: record.erveDispatchNumber,
    ervePackingList: record.ervePackingList,
    saleOrder: record.saleOrder,
    distributor: record.distributor,
    status: record.status,
    dispatchDate: record.dispatchDate.toISOString(),
    transporter: record.transporter,
    vehicleNumber: record.vehicleNumber,
    lrNumber: record.lrNumber,
    remarks: record.remarks,
    dispatchedBy: record.dispatchedBy,
    dispatchedAt: record.dispatchedAt.toISOString(),
    lrUpdatedBy: record.lrUpdatedBy,
    lrUpdatedAt: record.lrUpdatedAt?.toISOString() ?? null,
    deliveredBy: record.deliveredBy,
    deliveredAt: record.deliveredAt?.toISOString() ?? null,
    deliveryRemarks: record.deliveryRemarks,
    deliveryConfirmationSource: record.deliveryConfirmationSource,
    totalQuantity,
    invoiceHandoffs,
    saleOrReturnLines,
    version: record.version,
    updatedAt: record.dispatchedAt.toISOString(),
  };
}

async function loadErveDispatch(id: string): Promise<ErveDispatchRecord> {
  const record = await prisma.erveDispatch.findUnique({ where: { id }, include: erveDispatchInclude });
  if (!record) throw HttpError.notFound('Erve dispatch not found');
  return record;
}

export async function getErveDispatchDetail(actor: CurrentUser, id: string) {
  const record = await loadErveDispatch(id);
  assertDispatchViewAccess(actor, record.distributor.id);
  return toErveDispatchView(record);
}

export async function getErveDispatchList(
  actor: CurrentUser,
  filters: { saleOrderId?: string; distributorId?: string; cursor?: string; limit: number },
) {
  if (!canViewErveDispatch(actor)) {
    throw HttpError.forbidden('You do not have permission to view Erve Dispatches');
  }
  const distributorId = isBroadErveDispatchViewer(actor) ? filters.distributorId : getSoleDistributorId(actor);

  const records = await prisma.erveDispatch.findMany({
    where: { saleOrderId: filters.saleOrderId, distributorId },
    include: erveDispatchInclude,
    orderBy: { id: 'desc' },
    take: filters.limit + 1,
    cursor: filters.cursor ? { id: filters.cursor } : undefined,
    skip: filters.cursor ? 1 : undefined,
  });
  const hasMore = records.length > filters.limit;
  const page = hasMore ? records.slice(0, filters.limit) : records;
  const items = await Promise.all(page.map(toErveDispatchView));
  return { items, pageInfo: { limit: filters.limit, hasMore, nextCursor: hasMore ? page.at(-1)!.id : null } };
}

export interface RecordErveDispatchInput {
  ervePackingListId: string;
  dispatchDate: string;
  transporter?: string | null;
  vehicleNumber?: string | null;
  lrNumber?: string | null;
  remarks?: string | null;
}

export async function recordErveDispatch(actor: CurrentUser, input: RecordErveDispatchInput) {
  assertDispatchMutationAccess(actor);

  const dispatchId = createId();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`erve-packing-list-${input.ervePackingListId}`}))`;

    const packingList = await tx.ervePackingList.findUnique({ where: { id: input.ervePackingListId } });
    if (!packingList) throw HttpError.notFound('Erve packing list not found');
    if (packingList.status !== 'FINALIZED') {
      throw HttpError.conflict('This Erve Packing List must be finalized before it can be dispatched');
    }
    if (!packingList.distributorId) {
      throw HttpError.conflict('This Erve Packing List has no established Distributor');
    }

    const financialYear = await ensureFinancialYear(tx, new Date(input.dispatchDate));
    const { erveDispatchNumber, erveDispatchSerial } = await generateErveDispatchNumber(tx, financialYear);

    await tx.erveDispatch.create({
      data: {
        id: dispatchId,
        erveDispatchNumber,
        ervePackingListId: input.ervePackingListId,
        saleOrderId: packingList.saleOrderId,
        distributorId: packingList.distributorId,
        status: 'DISPATCHED',
        dispatchDate: new Date(input.dispatchDate),
        transporter: input.transporter ?? null,
        vehicleNumber: input.vehicleNumber ?? null,
        lrNumber: input.lrNumber ?? null,
        remarks: input.remarks ?? null,
        dispatchedById: actor.id,
        financialYearId: financialYear.id,
        erveDispatchSerial,
      },
    });
    await tx.ervePackingList.update({ where: { id: input.ervePackingListId }, data: { status: 'DISPATCHED' } });

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'ERVE_DISPATCH_RECORDED',
        entityType: 'ErveDispatch',
        entityId: dispatchId,
        metadata: { erveDispatchNumber, ervePackingListId: input.ervePackingListId, distributorId: packingList.distributorId },
      },
      tx,
    );

    // OUTRIGHT-sourced quantity in this Dispatch becomes invoiceable
    // immediately — one PENDING_TALLY InvoiceHandoff per SaleOrderLine, in
    // this same transaction. SALE_RETURN-sourced quantity gets nothing here:
    // it only becomes invoiceable once the Distributor reports it sold (see
    // distributor-sales-report.service.ts) — physical dispatch and financial
    // sale are separate events for SALE_RETURN (see the schema module doc).
    await createInvoiceHandoffsForDispatch(tx, actor, dispatchId, erveDispatchNumber, input.ervePackingListId);

    // Dispatch Order Phase 3: there is no persisted FULFILLED status to flip
    // to — "how far physically progressed" is entirely read-derived (see
    // computeDispatchOrderFulfillment in fulfillment-progress.ts), driven by
    // this same ErveDispatch/FactoryDispatch state, never a stored order
    // status transition.
  });

  return getErveDispatchDetail(actor, dispatchId);
}

export async function updateErveDispatchLr(
  actor: CurrentUser,
  id: string,
  input: { expectedVersion: number; transporter?: string | null; vehicleNumber?: string | null; lrNumber?: string | null },
) {
  assertDispatchMutationAccess(actor);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`erve-dispatch-${id}`}))`;

    const dispatch = await tx.erveDispatch.findUnique({ where: { id } });
    if (!dispatch) throw HttpError.notFound('Erve dispatch not found');
    if (dispatch.version !== input.expectedVersion) throw HttpError.staleVersion(dispatch.version);

    const updated = await tx.erveDispatch.updateMany({
      where: { id, version: input.expectedVersion },
      data: {
        transporter: input.transporter !== undefined ? input.transporter : undefined,
        vehicleNumber: input.vehicleNumber !== undefined ? input.vehicleNumber : undefined,
        lrNumber: input.lrNumber !== undefined ? input.lrNumber : undefined,
        lrUpdatedById: actor.id,
        lrUpdatedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw HttpError.staleVersion(dispatch.version);

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'ERVE_DISPATCH_LR_UPDATED',
        entityType: 'ErveDispatch',
        entityId: id,
        metadata: { erveDispatchNumber: dispatch.erveDispatchNumber },
      },
      tx,
    );
  });

  return getErveDispatchDetail(actor, id);
}

// ---------------------------------------------------------------------------
// Delivery confirmation — the "received by distributor" fact that
// DistributorSalesReport and DistributorReturn key off (see
// sale-or-return-quantities.ts). This is a single DISPATCHED -> DELIVERED
// transition (not append-only/repeatable) performed by the same
// merchandising-team fallback actor that already owns the LR update, per the
// BRD's "if transporter does not use the delivery link, the merchandising
// team... marks goods as delivered." POD upload / transporter link are out
// of scope here — only this fallback path is built.
// ---------------------------------------------------------------------------

export interface ConfirmErveDispatchDeliveryInput {
  expectedVersion: number;
  lines: Array<{ saleOrderLineId: string; receivedQuantity: number }>;
  remarks?: string | null;
}

export async function confirmErveDispatchDelivery(actor: CurrentUser, id: string, input: ConfirmErveDispatchDeliveryInput) {
  assertDispatchMutationAccess(actor);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`erve-dispatch-${id}`}))`;

    const dispatch = await tx.erveDispatch.findUnique({ where: { id } });
    if (!dispatch) throw HttpError.notFound('Erve dispatch not found');
    if (dispatch.version !== input.expectedVersion) throw HttpError.staleVersion(dispatch.version);
    if (dispatch.status !== 'DISPATCHED') {
      throw HttpError.conflict('This Erve Dispatch has already been marked delivered');
    }

    const packedLines = await tx.factoryPackingCartonLine.findMany({
      where: { carton: { ervePackingListId: dispatch.ervePackingListId, retiredAt: null } },
      select: { saleOrderLineId: true, quantity: true },
    });
    const dispatchedBySaleOrderLine = new Map<string, number>();
    for (const line of packedLines) {
      dispatchedBySaleOrderLine.set(line.saleOrderLineId, (dispatchedBySaleOrderLine.get(line.saleOrderLineId) ?? 0) + line.quantity);
    }

    const inputSaleOrderLineIds = new Set(input.lines.map((l) => l.saleOrderLineId));
    if (inputSaleOrderLineIds.size !== input.lines.length) {
      throw HttpError.badRequest('Duplicate saleOrderLineId entries are not allowed');
    }
    if (inputSaleOrderLineIds.size !== dispatchedBySaleOrderLine.size || [...dispatchedBySaleOrderLine.keys()].some((id) => !inputSaleOrderLineIds.has(id))) {
      throw HttpError.badRequest('Delivery confirmation must cover exactly the lines dispatched on this Erve Dispatch');
    }

    let totalReceived = 0;
    let anyShort = false;
    for (const line of input.lines) {
      const dispatchedQuantity = dispatchedBySaleOrderLine.get(line.saleOrderLineId);
      if (dispatchedQuantity === undefined) {
        throw HttpError.badRequest(`Sale order line ${line.saleOrderLineId} was not dispatched on this Erve Dispatch`);
      }
      if (line.receivedQuantity < 0 || line.receivedQuantity > dispatchedQuantity) {
        throw HttpError.badRequest(`Received quantity for ${line.saleOrderLineId} must be between 0 and the dispatched quantity (${dispatchedQuantity})`);
      }
      totalReceived += line.receivedQuantity;
      if (line.receivedQuantity < dispatchedQuantity) anyShort = true;
    }

    if (totalReceived <= 0) {
      throw HttpError.badRequest('At least one line must have a received quantity greater than zero to confirm delivery');
    }
    if (anyShort && !input.remarks?.trim()) {
      throw HttpError.badRequest('Delivery remarks are required when any line is received short of the dispatched quantity');
    }

    await tx.erveDispatchDeliveryLine.createMany({
      data: input.lines.map((line) => ({
        id: createId(),
        erveDispatchId: id,
        saleOrderLineId: line.saleOrderLineId,
        receivedQuantity: line.receivedQuantity,
      })),
    });

    const updated = await tx.erveDispatch.updateMany({
      where: { id, version: input.expectedVersion },
      data: {
        status: 'DELIVERED',
        deliveredById: actor.id,
        deliveredAt: new Date(),
        deliveryRemarks: input.remarks ?? null,
        deliveryConfirmationSource: 'USER_CONFIRMED',
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw HttpError.staleVersion(dispatch.version);

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'ERVE_DISPATCH_DELIVERY_CONFIRMED',
        entityType: 'ErveDispatch',
        entityId: id,
        metadata: { erveDispatchNumber: dispatch.erveDispatchNumber, totalReceived, lineCount: input.lines.length },
      },
      tx,
    );
  });

  return getErveDispatchDetail(actor, id);
}
