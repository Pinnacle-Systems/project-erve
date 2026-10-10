import { createId, resolveGstStateCode } from '@erve/shared';
import { canMutateTaxInvoice, canViewTaxInvoice } from '@erve/shared';
import { Prisma, prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import { resolveSoleActiveSellerRegistration } from '../master-data/seller-registration.service.js';
import { allocateDocumentSerial } from '../master-data/document-sequence.service.js';
import { DOCUMENT_PREFIXES, formatDocumentNumber } from '../master-data/document-number.util.js';
import { ensureFinancialYear } from '../master-data/financial-year.service.js';
import { toBusinessCalendarDate } from '../master-data/financial-year.util.js';
import { resolveGstRuleForHsn } from '../tax-rules/gst-rule-sets.service.js';
import {
  aggregateHsnSummary,
  aggregateInvoiceTotals,
  calculateGrandTotal,
  calculatePayableRounding,
  classifyGstTreatment,
  computeLineTax,
  computeNormalUnitRate,
  resolveFinalUnitRate,
  type LineTaxResult,
} from './tax-invoice-calculation.js';

type Tx = Prisma.TransactionClient;

// Shared by override and finalize so the two can never race each other on
// the same invoice — both acquire this exact lock before reading status.
function taxInvoiceLifecycleLockKey(taxInvoiceId: string): string {
  return `tax-invoice-finalize-${taxInvoiceId}`;
}

// INV-012's EI Numbering Cutover Runbook, §8.1 "Sequence Auto-Seed Guard",
// assigns this explicitly to INV-006: "Attempting to allocate a Tax Invoice
// serial on an un-baselined sequence in production must throw a fatal
// guard exception." allocateDocumentSerial's own upsert otherwise defaults
// a brand-new (documentType, financialYearId) row to lastAllocatedSerial=1
// — correct for every OTHER document type's first-ever document, but wrong
// here: a production EI sequence must only ever start from the verified
// external high-water mark the document-sequence-baseline CLI sets, never
// from an auto-seeded 1. Non-production environments (dev/test) are
// intentionally exempt — this is what lets this story's own tests and any
// local/dev finalize flow work without running the INV-012 baseline CLI
// first. Exported as a pure function (nodeEnv/sequenceAlreadyExists passed
// in explicitly) so it's unit-testable without mocking the process-wide env
// singleton or standing up a real "production" server process.
export function assertTaxInvoiceSequenceBaselined(
  nodeEnv: string,
  sequenceAlreadyExists: boolean,
  financialYearCode: string,
): void {
  if (nodeEnv !== 'production' || sequenceAlreadyExists) return;
  throw HttpError.conflict(
    'Tax Invoice numbering for this Financial Year has not been baselined against the verified external high-water mark — finalization is blocked until the INV-012 cutover procedure (EI_NUMBERING_CUTOVER_RUNBOOK.md) completes',
    { reason: 'TAX_INVOICE_SEQUENCE_NOT_BASELINED', financialYearCode },
  );
}

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

  const commercialLines = await tx.ervePackingListCommercialLine.findMany({
    where: { ervePackingListId },
  });

  if (commercialLines.length === 0) {
    throw HttpError.badRequest(
      'This Erve Packing List predates commercial snapshotting (INV-004) and has no frozen pricing basis; a Tax Invoice cannot be drafted from it',
      { ervePackingListId, reason: 'COMMERCIAL_SNAPSHOT_MISSING' },
    );
  }

  const commercialBySaleOrderLine = new Map(
    commercialLines.map((line) => [line.saleOrderLineId, line]),
  );

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

  const mismatched: Array<{
    saleOrderLineId: string;
    cartonQuantity: number;
    commercialQuantity: number;
  }> = [];
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
  financialYear: { select: { id: true, code: true } },
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
      // The line's own frozen HSN (set only at finalization) — takes
      // precedence over the live style.hsn join below once present.
      hsn: { select: { code: true, description: true } },
      overriddenBy: { select: { id: true, name: true, email: true } },
      saleOrderLine: { select: { id: true, size: { select: { code: true, label: true } } } },
    },
  },
} satisfies Prisma.TaxInvoiceInclude;

type TaxInvoiceRecord = Prisma.TaxInvoiceGetPayload<{ include: typeof taxInvoiceInclude }>;

function toTaxInvoiceView(record: TaxInvoiceRecord) {
  // Derived at read time from the already-persisted, immutable line
  // snapshots — never a separately stored/duplicated table. Null for a
  // DRAFT (nothing to summarize yet); every finalized line always has
  // hsnCode/gstPercent/amounts set together, so this is safe once FINALIZED.
  const hsnSummary =
    record.status === 'FINALIZED'
      ? aggregateHsnSummary(
          record.lines.map((line) => ({
            hsnCode: line.hsnCode!,
            gstPercent: line.gstPercent!,
            taxableValue: line.taxableValue!,
            cgstAmount: line.cgstAmount!,
            sgstAmount: line.sgstAmount!,
            igstAmount: line.igstAmount!,
          })),
        ).map((row) => ({
          hsnCode: row.hsnCode,
          gstPercent: row.gstPercent.toString(),
          taxableValue: row.taxableValue.toString(),
          cgstAmount: row.cgstAmount.toString(),
          sgstAmount: row.sgstAmount.toString(),
          igstAmount: row.igstAmount.toString(),
        }))
      : null;

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
      // Resolved + validated only at finalization; null on every DRAFT. Also
      // the Place-of-Supply code (same value, by this story's confirmed
      // business rule — see the TaxInvoice model's schema doc comment).
      stateCode: record.billToStateCode,
      country: record.billToCountry,
      postalCode: record.billToPostalCode,
    },
    gstTreatment: record.gstTreatment,
    financialYear: record.financialYear
      ? { id: record.financialYear.id, code: record.financialYear.code }
      : null,
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
      style: {
        id: line.style.id,
        styleNumber: line.style.styleNumber,
        styleName: line.style.styleName,
      },
      // The line's own frozen HSN (set only at finalization) takes
      // precedence; a DRAFT line still falls back to the live Style join,
      // exactly as INV-005 already did (see the TaxInvoice model's schema
      // doc comment).
      hsn: line.hsn
        ? { code: line.hsn.code, description: line.hsn.description }
        : line.style.hsn
          ? { code: line.style.hsn.code, description: line.style.hsn.description }
          : null,
      size: { code: line.saleOrderLine.size.code, label: line.saleOrderLine.size.label },
      quantity: line.quantity,
      styleMrp: line.styleMrp.toString(),
      distributorPricingPercentage: line.distributorPricingPercentage.toString(),
      priceListId: line.priceListId,
      // INV-006 — all null until an override and/or finalization sets them.
      // Serialized via .toString(), never .toNumber(), so the scale-6/11
      // precision never round-trips through a JS number in the API response.
      calculatedUnitRate: line.calculatedUnitRate?.toString() ?? null,
      overrideUnitRate: line.overrideUnitRate?.toString() ?? null,
      overrideReason: line.overrideReason,
      overriddenBy: line.overriddenBy,
      overriddenAt: line.overriddenAt?.toISOString() ?? null,
      finalUnitRate: line.finalUnitRate?.toString() ?? null,
      gstPercent: line.gstPercent?.toString() ?? null,
      taxableValue: line.taxableValue?.toString() ?? null,
      cgstAmount: line.cgstAmount?.toString() ?? null,
      sgstAmount: line.sgstAmount?.toString() ?? null,
      igstAmount: line.igstAmount?.toString() ?? null,
    })),
    // INV-006 — unrounded aggregate totals plus the single rounded
    // grandTotal; all null until finalization.
    subtotal: record.subtotal?.toString() ?? null,
    totalCgst: record.totalCgst?.toString() ?? null,
    totalSgst: record.totalSgst?.toString() ?? null,
    totalIgst: record.totalIgst?.toString() ?? null,
    totalGst: record.totalGst?.toString() ?? null,
    // .toFixed(2), not .toString() — grandTotal is always exactly the
    // rounded 2dp value by construction, and decimal.js's toString() drops
    // trailing zeros (e.g. "1050" instead of "1050.00"), which would be an
    // inconsistent wire format for the one field that's supposed to be a
    // clean, final, two-decimal monetary amount.
    grandTotal: record.grandTotal?.toFixed(2) ?? null,
    // PR0 snapshots: unavailable on legacy finalized documents. Never
    // derive these during reads or substitute zero for a missing adjustment.
    payableTotal: record.payableTotal?.toFixed(2) ?? null,
    roundOffAdjustment: record.roundOffAdjustment?.toFixed(2) ?? null,
    roundingPolicy: record.roundingPolicy,
    hsnSummary,
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

    const existing = await tx.taxInvoice.findUnique({
      where: { ervePackingListId },
      select: { id: true },
    });
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
      throw HttpError.conflict(
        'This Erve Packing List must be finalized before a Tax Invoice draft can be created',
      );
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
    const seller = await tx.sellerRegistration.findUniqueOrThrow({
      where: { id: sellerOption.id },
    });

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

export async function getTaxInvoiceByErvePackingListId(
  actor: CurrentUser,
  ervePackingListId: string,
) {
  assertViewAccess(actor);
  const record = await prisma.taxInvoice.findUnique({
    where: { ervePackingListId },
    include: taxInvoiceInclude,
  });
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
  return {
    items,
    pageInfo: { limit: filters.limit, hasMore, nextCursor: hasMore ? page.at(-1)!.id : null },
  };
}

// ---------------------------------------------------------------------------
// INV-006: Accountant rate override. Shares the finalize lifecycle lock
// (taxInvoiceLifecycleLockKey) so an override and a finalize on the same
// invoice can never race each other.
// ---------------------------------------------------------------------------

export interface OverrideTaxInvoiceLineRateInput {
  overrideUnitRate: Prisma.Decimal;
  reason: string;
}

export async function overrideTaxInvoiceLineRate(
  actor: CurrentUser,
  taxInvoiceId: string,
  lineId: string,
  input: OverrideTaxInvoiceLineRateInput,
): Promise<TaxInvoiceView> {
  assertMutationAccess(actor);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${taxInvoiceLifecycleLockKey(taxInvoiceId)}))`;

    const invoice = await tx.taxInvoice.findUnique({
      where: { id: taxInvoiceId },
      select: { status: true },
    });
    if (!invoice) throw HttpError.notFound('Tax invoice not found');
    if (invoice.status !== 'DRAFT') {
      throw HttpError.conflict(
        'A Tax Invoice line can only be overridden while the invoice is still DRAFT',
      );
    }

    const line = await tx.taxInvoiceLine.findUnique({ where: { id: lineId } });
    if (!line || line.taxInvoiceId !== taxInvoiceId) {
      throw HttpError.notFound('Tax invoice line not found on this invoice');
    }

    // Recorded alongside the override so the original calculated rate is
    // never lost even though it is also re-derivable from styleMrp/
    // distributorPricingPercentage — matches §1.3's "persist the original
    // calculated unit rate" requirement explicitly, not just implicitly.
    const calculatedUnitRate = computeNormalUnitRate(
      line.styleMrp,
      line.distributorPricingPercentage,
    );
    const overriddenAt = new Date();

    await tx.taxInvoiceLine.update({
      where: { id: lineId },
      data: {
        calculatedUnitRate,
        overrideUnitRate: input.overrideUnitRate,
        overrideReason: input.reason,
        overriddenById: actor.id,
        overriddenAt,
      },
    });

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'TAX_INVOICE_LINE_RATE_OVERRIDDEN',
        entityType: 'TaxInvoiceLine',
        entityId: lineId,
        metadata: {
          taxInvoiceId,
          calculatedUnitRate: calculatedUnitRate.toString(),
          overrideUnitRate: input.overrideUnitRate.toString(),
          reason: input.reason,
        },
      },
      tx,
    );
  });

  return toTaxInvoiceView(await loadTaxInvoiceById(taxInvoiceId));
}

// ---------------------------------------------------------------------------
// INV-006: Atomic DRAFT -> FINALIZED finalization.
//
// Idempotent: if the invoice is already FINALIZED when the lock is
// acquired, this makes no further writes, allocates no serial and records
// no additional audit entry — it simply falls through to the unconditional
// reload below, which returns the existing persisted finalized document.
// This correctly handles both a plain retry and two concurrent requests for
// the SAME invoice (the second one blocks on the advisory lock until the
// first commits, then sees status === 'FINALIZED' and takes this branch).
//
// Two different invoices finalizing concurrently in the same Financial Year
// don't contend on this lock at all (it's keyed by taxInvoiceId), but still
// serialize correctly on allocateDocumentSerial's own inner
// pg_advisory_xact_lock (keyed by documentType:financialYearId) — two
// independent, non-overlapping lock keyspaces composed together, not a new
// locking primitive.
//
// All fail-closed validation (commercial snapshot, Bill-To state/GSTIN
// consistency, HSN/GST resolution) happens before allocateDocumentSerial is
// called, so a doomed finalize never consumes a number — belt-and-suspenders
// on top of the fact that a thrown error rolls back the whole transaction,
// including the serial increment, anyway.
// ---------------------------------------------------------------------------

export async function finalizeTaxInvoice(
  actor: CurrentUser,
  taxInvoiceId: string,
): Promise<TaxInvoiceView> {
  assertMutationAccess(actor);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${taxInvoiceLifecycleLockKey(taxInvoiceId)}))`;

    const invoice = await tx.taxInvoice.findUnique({
      where: { id: taxInvoiceId },
      include: { lines: true },
    });
    if (!invoice) throw HttpError.notFound('Tax invoice not found');

    if (invoice.status === 'FINALIZED') return; // idempotent — see header comment
    if (invoice.status !== 'DRAFT') {
      throw HttpError.conflict('Only a DRAFT Tax Invoice can be finalized');
    }
    // Unreachable in practice — draft creation refuses an EIPL with no
    // commercial lines (COMMERCIAL_SNAPSHOT_MISSING) — kept as a defensive
    // guard, same stance as other "unreachable, but fail loudly" checks in
    // this module.
    if (invoice.lines.length === 0) {
      throw HttpError.conflict('A Tax Invoice with no lines cannot be finalized');
    }

    // Revalidate the EIPL's frozen commercial snapshot is still internally
    // consistent — the exact same check draft creation performs, reused
    // rather than duplicated.
    await loadAndValidateCommercialLines(tx, invoice.ervePackingListId);

    // --- Place of Supply: resolve from the snapshotted Bill-To ADDRESS
    // state (never the GSTIN, never Ship-To), then cross-validate against
    // the Bill-To GSTIN's own 2-digit prefix. Fails closed on either step.
    const billToStateCode = resolveGstStateCode(invoice.billToState);
    if (!billToStateCode) {
      throw HttpError.badRequest(
        'The Bill-To address state could not be resolved to a recognized GST state/UT name — finalization cannot proceed',
        { reason: 'BILL_TO_STATE_UNRESOLVED', billToState: invoice.billToState },
      );
    }
    const billToGstinStateCode = invoice.billToGstin.slice(0, 2);
    if (billToStateCode !== billToGstinStateCode) {
      throw HttpError.badRequest(
        "The Bill-To address state does not match the Bill-To GSTIN's registered state — finalization cannot proceed",
        { reason: 'BILL_TO_STATE_GSTIN_MISMATCH', billToStateCode, billToGstinStateCode },
      );
    }
    const gstTreatment = classifyGstTreatment(invoice.sellerStateCode, billToStateCode);

    const finalizedAt = new Date();
    const businessDate = toBusinessCalendarDate(finalizedAt);

    const styleIds = [...new Set(invoice.lines.map((line) => line.styleId))];
    const styles = await tx.style.findMany({
      where: { id: { in: styleIds } },
      select: { id: true, hsnId: true },
    });
    const hsnIdByStyleId = new Map(styles.map((style) => [style.id, style.hsnId]));

    interface ResolvedLine extends LineTaxResult {
      id: string;
      hsnId: string;
      hsnCode: string;
      gstRuleSetVersionId: string;
      gstValueBandId: string;
      calculatedUnitRate: Prisma.Decimal;
      finalUnitRate: Prisma.Decimal;
      gstPercent: Prisma.Decimal;
    }
    const resolvedLines: ResolvedLine[] = [];

    for (const line of invoice.lines) {
      const hsnId = hsnIdByStyleId.get(line.styleId);
      if (!hsnId) {
        throw HttpError.badRequest(
          "A line's Style has no assigned HSN — finalization cannot proceed until HSN master data is complete",
          { reason: 'HSN_NOT_ASSIGNED', taxInvoiceLineId: line.id, styleId: line.styleId },
        );
      }

      const calculatedUnitRate = computeNormalUnitRate(
        line.styleMrp,
        line.distributorPricingPercentage,
      );
      const finalUnitRate = resolveFinalUnitRate(calculatedUnitRate, line.overrideUnitRate);

      const resolution = await resolveGstRuleForHsn({
        hsnId,
        date: businessDate,
        value: finalUnitRate,
      });
      if (!resolution.found) {
        throw HttpError.badRequest(
          "No applicable GST rule could be resolved for a line's HSN — finalization cannot proceed until GST configuration is complete and active",
          { reason: resolution.reason, taxInvoiceLineId: line.id, hsnId },
        );
      }

      const gstPercent = new Prisma.Decimal(resolution.band.gstPercent);
      const lineTax = computeLineTax(finalUnitRate, line.quantity, gstPercent, gstTreatment);

      resolvedLines.push({
        id: line.id,
        hsnId: resolution.hsnId,
        hsnCode: resolution.hsnCode,
        gstRuleSetVersionId: resolution.versionId,
        gstValueBandId: resolution.band.id,
        calculatedUnitRate,
        finalUnitRate,
        gstPercent,
        ...lineTax,
      });
    }

    const totals = aggregateInvoiceTotals(resolvedLines);
    const grandTotal = calculateGrandTotal(totals.subtotal, totals.totalGst);
    const payableRounding = calculatePayableRounding(totals.subtotal, totals.totalGst, grandTotal);

    const financialYear = await ensureFinancialYear(tx, businessDate);

    // Same advisory lock allocateDocumentSerial itself takes (identical key
    // construction, document-sequence.service.ts) — taken here too so the
    // existence-check below and the allocation are atomic together. Without
    // this, two concurrent first-ever production finalizations for a
    // brand-new FY could both pass the check before either creates the row,
    // letting one slip through and auto-seed at 1 anyway. Re-acquiring the
    // same advisory lock a second time (inside allocateDocumentSerial, a few
    // lines below) within the same transaction/session is a safe no-op in
    // Postgres, not a self-deadlock.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'TAX_INVOICE'}::text || ':' || ${financialYear.id}, 0))`;
    const existingSequence = await tx.documentSequence.findUnique({
      where: {
        documentType_financialYearId: {
          documentType: 'TAX_INVOICE',
          financialYearId: financialYear.id,
        },
      },
    });
    assertTaxInvoiceSequenceBaselined(env.NODE_ENV, existingSequence !== null, financialYear.code);

    const serial = await allocateDocumentSerial(tx, 'TAX_INVOICE', financialYear.id);
    const invoiceNumber = formatDocumentNumber(
      DOCUMENT_PREFIXES.TAX_INVOICE,
      financialYear.code,
      serial,
    );

    for (const resolved of resolvedLines) {
      await tx.taxInvoiceLine.update({
        where: { id: resolved.id },
        data: {
          hsnId: resolved.hsnId,
          hsnCode: resolved.hsnCode,
          gstRuleSetVersionId: resolved.gstRuleSetVersionId,
          gstValueBandId: resolved.gstValueBandId,
          calculatedUnitRate: resolved.calculatedUnitRate,
          finalUnitRate: resolved.finalUnitRate,
          gstPercent: resolved.gstPercent,
          taxableValue: resolved.taxableValue,
          cgstAmount: resolved.cgstAmount,
          sgstAmount: resolved.sgstAmount,
          igstAmount: resolved.igstAmount,
        },
      });
    }

    await tx.taxInvoice.update({
      where: { id: taxInvoiceId },
      data: {
        status: 'FINALIZED',
        invoiceNumber,
        billToStateCode,
        gstTreatment,
        financialYearId: financialYear.id,
        subtotal: totals.subtotal,
        totalCgst: totals.totalCgst,
        totalSgst: totals.totalSgst,
        totalIgst: totals.totalIgst,
        totalGst: totals.totalGst,
        grandTotal,
        ...payableRounding,
        finalizedById: actor.id,
        finalizedAt,
      },
    });

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'TAX_INVOICE_FINALIZED',
        entityType: 'TaxInvoice',
        entityId: taxInvoiceId,
        metadata: {
          invoiceNumber,
          gstTreatment,
          billToStateCode,
          grandTotal: grandTotal.toString(),
          payableTotal: payableRounding.payableTotal.toFixed(2),
          roundOffAdjustment: payableRounding.roundOffAdjustment.toFixed(2),
          roundingPolicy: payableRounding.roundingPolicy,
          lineCount: resolvedLines.length,
        },
      },
      tx,
    );
  });

  return toTaxInvoiceView(await loadTaxInvoiceById(taxInvoiceId));
}
