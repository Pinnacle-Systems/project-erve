import { createId } from '@erve/shared';
import { canMutateTaxInvoice, canViewTaxInvoice } from '@erve/shared';
import { Prisma, prisma } from '../../db/prisma.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import { resolveSoleActiveSellerRegistration } from '../master-data/seller-registration.service.js';

type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Access helpers
// ---------------------------------------------------------------------------

function assertMutationAccess(actor: CurrentUser): void {
  if (!canMutateTaxInvoice(actor)) {
    throw HttpError.forbidden('You do not have permission to create a Tax Invoice draft');
  }
}

function assertViewAccess(actor: CurrentUser): void {
  if (!canViewTaxInvoice(actor)) {
    throw HttpError.forbidden('You do not have permission to view Tax Invoices');
  }
}

// ---------------------------------------------------------------------------
// Commercial snapshot completeness (INV-005 correction #3) — a zero-row
// check alone is insufficient. This recomputes the SAME carton-derived
// per-SaleOrderLine quantity aggregation finalizeErvePackingList's own
// buildCommercialSnapshotLines used when it wrote the snapshot
// (erve-dispatch.service.ts), and cross-checks it against the actual
// ErvePackingListCommercialLine rows: every carton-derived line must have a
// commercial line, every commercial line must still correspond to a
// carton-derived line, and the quantities must match exactly. Any
// discrepancy is rejected explicitly — never recalculated from live
// Style/PriceList masters, never silently treated as zero.
// ---------------------------------------------------------------------------

async function loadAndValidateCommercialLines(tx: Tx, ervePackingListId: string) {
  const cartonLines = await tx.factoryPackingCartonLine.findMany({
    where: { carton: { ervePackingListId, retiredAt: null } },
    select: { saleOrderLineId: true, quantity: true },
  });

  const cartonQuantityBySaleOrderLine = new Map<string, number>();
  for (const line of cartonLines) {
    cartonQuantityBySaleOrderLine.set(
      line.saleOrderLineId,
      (cartonQuantityBySaleOrderLine.get(line.saleOrderLineId) ?? 0) + line.quantity,
    );
  }

  const commercialLines = await tx.ervePackingListCommercialLine.findMany({ where: { ervePackingListId } });

  if (commercialLines.length === 0) {
    throw HttpError.badRequest(
      'This Erve Packing List predates commercial snapshotting (INV-004) and has no frozen pricing basis; a Tax Invoice cannot be drafted from it',
      { ervePackingListId, reason: 'COMMERCIAL_SNAPSHOT_MISSING' },
    );
  }

  const commercialBySaleOrderLine = new Map(commercialLines.map((line) => [line.saleOrderLineId, line]));

  const missingSaleOrderLineIds = [...cartonQuantityBySaleOrderLine.keys()].filter(
    (id) => !commercialBySaleOrderLine.has(id),
  );
  if (missingSaleOrderLineIds.length > 0) {
    throw HttpError.badRequest(
      "This Erve Packing List's frozen commercial snapshot is incomplete — some carton-derived Dispatch Order lines have no commercial line",
      { ervePackingListId, reason: 'COMMERCIAL_SNAPSHOT_INCOMPLETE', missingSaleOrderLineIds },
    );
  }

  const orphanedSaleOrderLineIds = [...commercialBySaleOrderLine.keys()].filter(
    (id) => !cartonQuantityBySaleOrderLine.has(id),
  );
  if (orphanedSaleOrderLineIds.length > 0) {
    throw HttpError.badRequest(
      "This Erve Packing List's frozen commercial snapshot references lines no longer present in its carton composition",
      { ervePackingListId, reason: 'COMMERCIAL_SNAPSHOT_INCONSISTENT', orphanedSaleOrderLineIds },
    );
  }

  const mismatched: Array<{ saleOrderLineId: string; cartonQuantity: number; commercialQuantity: number }> = [];
  for (const [saleOrderLineId, cartonQuantity] of cartonQuantityBySaleOrderLine) {
    const commercialQuantity = commercialBySaleOrderLine.get(saleOrderLineId)!.quantity;
    if (commercialQuantity !== cartonQuantity) {
      mismatched.push({ saleOrderLineId, cartonQuantity, commercialQuantity });
    }
  }
  if (mismatched.length > 0) {
    throw HttpError.badRequest(
      "This Erve Packing List's frozen commercial snapshot quantities no longer match its carton composition",
      { ervePackingListId, reason: 'COMMERCIAL_SNAPSHOT_QUANTITY_MISMATCH', mismatched },
    );
  }

  return commercialLines;
}

// ---------------------------------------------------------------------------
// View shaping
// ---------------------------------------------------------------------------

const taxInvoiceInclude = {
  ervePackingList: {
    select: {
      id: true,
      ervePackingListNumber: true,
      status: true,
      dispatch: { select: { id: true, erveDispatchNumber: true, status: true } },
    },
  },
  distributor: { select: { id: true, code: true, name: true } },
  sellerRegistration: { select: { id: true, branchCode: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  finalizedBy: { select: { id: true, name: true, email: true } },
  lines: {
    include: {
      style: {
        select: {
          id: true,
          styleNumber: true,
          styleName: true,
          hsn: { select: { code: true, description: true } },
        },
      },
      saleOrderLine: { select: { id: true, size: { select: { code: true, label: true } } } },
    },
  },
} satisfies Prisma.TaxInvoiceInclude;

type TaxInvoiceRecord = Prisma.TaxInvoiceGetPayload<{ include: typeof taxInvoiceInclude }>;

function toTaxInvoiceView(record: TaxInvoiceRecord) {
  return {
    id: record.id,
    status: record.status,
    invoiceNumber: record.invoiceNumber,
    ervePackingList: {
      id: record.ervePackingList.id,
      ervePackingListNumber: record.ervePackingList.ervePackingListNumber,
      status: record.ervePackingList.status,
    },
    // Null until the physical Erve Dispatch is recorded — a draft may exist
    // before that happens (see the module doc on the TaxInvoice model).
    erveDispatch: record.ervePackingList.dispatch,
    distributor: record.distributor,
    purchaseMode: record.purchaseMode,
    seller: {
      id: record.sellerRegistrationId,
      branchCode: record.sellerRegistration.branchCode,
      legalName: record.sellerLegalName,
      tradeName: record.sellerTradeName,
      gstin: record.sellerGstin,
      einvoiceApplicable: record.sellerEinvoiceApplicable,
      addressLine1: record.sellerAddressLine1,
      addressLine2: record.sellerAddressLine2,
      city: record.sellerCity,
      state: record.sellerState,
      stateCode: record.sellerStateCode,
      postalCode: record.sellerPostalCode,
      country: record.sellerCountry,
      // Bank snapshot — every viewer here is already ADMIN/ACCOUNTANT
      // (TAX_INVOICE_VIEW_ROLES), so no further redaction is applied; see
      // the TaxInvoice model's schema doc comment.
      bankName: record.sellerBankName,
      bankAccountName: record.sellerBankAccountName,
      bankAccountNumber: record.sellerBankAccountNumber,
      bankIfsc: record.sellerBankIfsc,
      bankBranchName: record.sellerBankBranchName,
      bankAddress: record.sellerBankAddress,
    },
    billTo: {
      name: record.billToName,
      gstin: record.billToGstin,
      contactName: record.billToContactName,
      contactEmail: record.billToContactEmail,
      contactPhone: record.billToContactPhone,
      addressLine1: record.billToAddressLine1,
      addressLine2: record.billToAddressLine2,
      city: record.billToCity,
      state: record.billToState,
      country: record.billToCountry,
      postalCode: record.billToPostalCode,
    },
    shipTo: {
      label: record.shipToLabel,
      contactName: record.shipToContactName,
      contactEmail: record.shipToContactEmail,
      contactPhone: record.shipToContactPhone,
      addressLine1: record.shipToAddressLine1,
      addressLine2: record.shipToAddressLine2,
      city: record.shipToCity,
      state: record.shipToState,
      country: record.shipToCountry,
      postalCode: record.shipToPostalCode,
    },
    lines: record.lines.map((line) => ({
      id: line.id,
      ervePackingListCommercialLineId: line.ervePackingListCommercialLineId,
      saleOrderLineId: line.saleOrderLineId,
      style: { id: line.style.id, styleNumber: line.style.styleNumber, styleName: line.style.styleName },
      // HSN is resolved live from Style — never frozen in INV-005 (see the
      // TaxInvoice model's schema doc comment on why).
      hsn: line.style.hsn ? { code: line.style.hsn.code, description: line.style.hsn.description } : null,
      size: { code: line.saleOrderLine.size.code, label: line.saleOrderLine.size.label },
      quantity: line.quantity,
      styleMrp: line.styleMrp.toString(),
      distributorPricingPercentage: line.distributorPricingPercentage.toString(),
      priceListId: line.priceListId,
    })),
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    finalizedBy: record.finalizedBy,
    finalizedAt: record.finalizedAt?.toISOString() ?? null,
    version: record.version,
  };
}

export type TaxInvoiceView = ReturnType<typeof toTaxInvoiceView>;

async function loadTaxInvoiceById(id: string): Promise<TaxInvoiceRecord> {
  const record = await prisma.taxInvoice.findUnique({ where: { id }, include: taxInvoiceInclude });
  if (!record) throw HttpError.notFound('Tax invoice not found');
  return record;
}

// ---------------------------------------------------------------------------
// Draft creation — idempotent create-or-get. Mirrors
// finalizeErvePackingList/recordErveDispatch's own concurrency pattern
// exactly: a pg_advisory_xact_lock scoped to the EIPL fully serializes
// concurrent requests for the same source, so the check-then-create below
// can never race — never a header-based Idempotency-Key record.
// ---------------------------------------------------------------------------

export interface TaxInvoiceDraftResult {
  taxInvoice: TaxInvoiceView;
  created: boolean;
}

export async function createOrGetTaxInvoiceDraft(
  actor: CurrentUser,
  ervePackingListId: string,
): Promise<TaxInvoiceDraftResult> {
  assertMutationAccess(actor);

  let created = false;
  const taxInvoiceId = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tax-invoice-${ervePackingListId}`}))`;

    const existing = await tx.taxInvoice.findUnique({ where: { ervePackingListId }, select: { id: true } });
    if (existing) return existing.id;

    const packingList = await tx.ervePackingList.findUnique({
      where: { id: ervePackingListId },
      include: { distributor: true },
    });
    if (!packingList) throw HttpError.notFound('Erve packing list not found');
    // A draft may be created any time after finalization — including after
    // the EIPL has gone on to DISPATCHED, which is no longer literally
    // 'FINALIZED' (ErvePackingListStatus: OPEN -> FINALIZED -> DISPATCHED).
    // Only OPEN is ineligible.
    if (packingList.status === 'OPEN') {
      throw HttpError.conflict('This Erve Packing List must be finalized before a Tax Invoice draft can be created');
    }
    if (!packingList.distributor) {
      // Unreachable once not OPEN — finalize requires a Distributor
      // (erve-dispatch.service.ts buildCommercialSnapshotLines). Defensive only.
      throw HttpError.conflict('This Erve Packing List has no established Distributor');
    }
    const distributor = packingList.distributor;

    const commercialLines = await loadAndValidateCommercialLines(tx, ervePackingListId);

    const sellerOption = await resolveSoleActiveSellerRegistration(tx);
    if (!sellerOption) {
      throw HttpError.conflict(
        'Exactly one ACTIVE Seller Registration is required to draft a Tax Invoice; none or more than one is currently active',
      );
    }
    const seller = await tx.sellerRegistration.findUniqueOrThrow({ where: { id: sellerOption.id } });

    const id = createId();

    await tx.taxInvoice.create({
      data: {
        id,
        status: 'DRAFT',
        ervePackingListId,
        distributorId: distributor.id,
        // Required, never nullable — see the model's schema doc comment on
        // why an EIPL can never genuinely mix Purchase Modes.
        purchaseMode: distributor.purchaseMode,

        sellerRegistrationId: seller.id,
        sellerLegalName: seller.legalName,
        sellerTradeName: seller.tradeName,
        sellerGstin: seller.gstin,
        sellerEinvoiceApplicable: seller.einvoiceApplicable,
        sellerAddressLine1: seller.addressLine1,
        sellerAddressLine2: seller.addressLine2,
        sellerCity: seller.city,
        sellerState: seller.state,
        sellerStateCode: seller.stateCode,
        sellerPostalCode: seller.postalCode,
        sellerCountry: seller.country,
        sellerBankName: seller.bankName,
        sellerBankAccountName: seller.bankAccountName,
        sellerBankAccountNumber: seller.bankAccountNumber,
        sellerBankIfsc: seller.bankIfsc,
        sellerBankBranchName: seller.bankBranchName,
        sellerBankAddress: seller.bankAddress,

        // Bill-To — from the Distributor master. name/gstin are required
        // there so required here; address fields mirror the master's own
        // optionality, never fabricated (see the model's schema doc comment).
        billToName: distributor.name,
        billToGstin: distributor.gstin,
        billToContactName: distributor.contactName,
        billToContactEmail: distributor.contactEmail,
        billToContactPhone: distributor.contactPhone,
        billToAddressLine1: distributor.addressLine1,
        billToAddressLine2: distributor.addressLine2,
        billToCity: distributor.city,
        billToState: distributor.state,
        billToCountry: distributor.country,
        billToPostalCode: distributor.postalCode,

        // Ship-To — copied verbatim from the EIPL's own destination
        // snapshot, never a live SaleOrderDestination row.
        shipToLabel: packingList.destinationLabel,
        shipToContactName: packingList.destinationContactName,
        shipToContactEmail: packingList.destinationContactEmail,
        shipToContactPhone: packingList.destinationContactPhone,
        shipToAddressLine1: packingList.destinationAddressLine1,
        shipToAddressLine2: packingList.destinationAddressLine2,
        shipToCity: packingList.destinationCity,
        shipToState: packingList.destinationState,
        shipToCountry: packingList.destinationCountry,
        shipToPostalCode: packingList.destinationPostalCode,

        createdById: actor.id,
      },
    });

    await tx.taxInvoiceLine.createMany({
      data: commercialLines.map((line) => ({
        id: createId(),
        taxInvoiceId: id,
        ervePackingListCommercialLineId: line.id,
        saleOrderLineId: line.saleOrderLineId,
        styleId: line.styleId,
        quantity: line.quantity,
        styleMrp: line.styleMrp,
        distributorPricingPercentage: line.distributorPricingPercentage,
        priceListId: line.priceListId,
      })),
    });

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'TAX_INVOICE_DRAFT_CREATED',
        entityType: 'TaxInvoice',
        entityId: id,
        metadata: {
          ervePackingListId,
          ervePackingListNumber: packingList.ervePackingListNumber,
          distributorId: distributor.id,
          lineCount: commercialLines.length,
        },
      },
      tx,
    );

    created = true;
    return id;
  });

  const taxInvoice = toTaxInvoiceView(await loadTaxInvoiceById(taxInvoiceId));
  return { taxInvoice, created };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getTaxInvoiceDetail(actor: CurrentUser, id: string) {
  assertViewAccess(actor);
  return toTaxInvoiceView(await loadTaxInvoiceById(id));
}

export async function getTaxInvoiceByErvePackingListId(actor: CurrentUser, ervePackingListId: string) {
  assertViewAccess(actor);
  const record = await prisma.taxInvoice.findUnique({ where: { ervePackingListId }, include: taxInvoiceInclude });
  if (!record) throw HttpError.notFound('No Tax Invoice draft exists for this Erve Packing List');
  return toTaxInvoiceView(record);
}

// Two-step resolution (EIPL<->ErveDispatch is already a strict, separately
// maintained 1:1 relationship) — see the TaxInvoice model's schema doc
// comment on why there is no stored erveDispatchId to look up directly.
export async function getTaxInvoiceByErveDispatchId(actor: CurrentUser, erveDispatchId: string) {
  assertViewAccess(actor);
  const dispatch = await prisma.erveDispatch.findUnique({
    where: { id: erveDispatchId },
    select: { ervePackingListId: true },
  });
  if (!dispatch) throw HttpError.notFound('Erve dispatch not found');

  const record = await prisma.taxInvoice.findUnique({
    where: { ervePackingListId: dispatch.ervePackingListId },
    include: taxInvoiceInclude,
  });
  if (!record) throw HttpError.notFound('No Tax Invoice draft exists for this Erve Dispatch');
  return toTaxInvoiceView(record);
}

export interface TaxInvoiceListFilters {
  distributorId?: string;
  status?: 'DRAFT' | 'FINALIZED';
  cursor?: string;
  limit: number;
}

export async function getTaxInvoiceList(actor: CurrentUser, filters: TaxInvoiceListFilters) {
  assertViewAccess(actor);

  const records = await prisma.taxInvoice.findMany({
    where: { distributorId: filters.distributorId, status: filters.status },
    include: taxInvoiceInclude,
    orderBy: { id: 'desc' },
    take: filters.limit + 1,
    cursor: filters.cursor ? { id: filters.cursor } : undefined,
    skip: filters.cursor ? 1 : undefined,
  });
  const hasMore = records.length > filters.limit;
  const page = hasMore ? records.slice(0, filters.limit) : records;
  const items = page.map(toTaxInvoiceView);
  return { items, pageInfo: { limit: filters.limit, hasMore, nextCursor: hasMore ? page.at(-1)!.id : null } };
}
