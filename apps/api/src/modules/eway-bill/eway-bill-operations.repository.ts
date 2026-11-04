import { createId } from '@erve/shared';
import type {
  EwayBillAuditEvent,
  EwayBillHistoryResponse,
  EwayBillMovementInfo,
  EwayBillMovementRecord,
} from '@erve/types';
import { recordAuditLog } from '../../audit/audit.service.js';
import { Prisma, prisma } from '../../db/prisma.js';
import { HttpError } from '../../errors/http-error.js';
import { readInvoiceDocumentSnapshot, invoiceDocumentLockKey } from '../fulfillment/tax-invoice-document.service.js';
import type { EwayBillRequestFacts } from './eway-bill-request.mapper.js';
import type {
  EwayBillMutationTx,
  EwayBillOperationsRepository,
  EwayBillSnapshot,
  StoredEwayBillAttempt,
} from './eway-bill-operations.port.js';
import { toAttemptView, toBillView } from './eway-bill-operations.views.js';

const APPLICATION_SCOPE = 'APPLICATION';
/** Audit rows for everything E-Way Bill on one Tax Invoice share this entity (id = the invoice id). */
export const EWAY_BILL_AUDIT_ENTITY = 'TaxInvoiceEwayBill';
const HISTORY_LIMIT = 100;

type Client = Prisma.TransactionClient;

const isoDate = (value: Date | null): string | null =>
  value ? value.toISOString().slice(0, 10) : null;
const calendarDate = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const userSelect = { select: { id: true, name: true } } as const;
const attemptInclude = {
  actor: userSelect,
  resolvedBy: userSelect,
  ewayBill: { select: { id: true } },
} as const;
const billInclude = { createdBy: userSelect } as const;

type MovementRow = Prisma.EwayBillMovementGetPayload<{ include: { updatedBy: typeof userSelect } }>;

function toMovementInfo(row: MovementRow | null): EwayBillMovementInfo {
  if (!row) {
    return {
      transportMode: null,
      vehicleNumber: null,
      vehicleType: null,
      transporterId: null,
      transporterName: null,
      transportDocumentNumber: null,
      transportDocumentDate: null,
      approximateDistanceKm: null,
      shipToArrangement: null,
      dispatchFromArrangement: null,
      dispatchFrom: null,
    };
  }
  const hasDispatchFrom =
    row.dispatchFromAddressLine1 ||
    row.dispatchFromAddressLine2 ||
    row.dispatchFromCity ||
    row.dispatchFromState ||
    row.dispatchFromStateCode ||
    row.dispatchFromPostalCode;
  return {
    transportMode: row.transportMode,
    vehicleNumber: row.vehicleNumber,
    vehicleType: row.vehicleType,
    transporterId: row.transporterId,
    transporterName: row.transporterName,
    transportDocumentNumber: row.transportDocumentNumber,
    transportDocumentDate: isoDate(row.transportDocumentDate),
    approximateDistanceKm: row.approximateDistanceKm,
    shipToArrangement: row.shipToArrangement,
    dispatchFromArrangement: row.dispatchFromArrangement,
    dispatchFrom: hasDispatchFrom
      ? {
          addressLine1: row.dispatchFromAddressLine1,
          addressLine2: row.dispatchFromAddressLine2,
          city: row.dispatchFromCity,
          state: row.dispatchFromState,
          stateCode: row.dispatchFromStateCode,
          postalCode: row.dispatchFromPostalCode,
        }
      : null,
  };
}

function movementColumns(movement: EwayBillMovementInfo) {
  const from = movement.dispatchFrom;
  return {
    transportMode: movement.transportMode,
    vehicleNumber: movement.vehicleNumber,
    vehicleType: movement.vehicleType,
    transporterId: movement.transporterId,
    transporterName: movement.transporterName,
    transportDocumentNumber: movement.transportDocumentNumber,
    transportDocumentDate: movement.transportDocumentDate
      ? calendarDate(movement.transportDocumentDate)
      : null,
    approximateDistanceKm: movement.approximateDistanceKm,
    shipToArrangement: movement.shipToArrangement,
    dispatchFromArrangement: movement.dispatchFromArrangement,
    dispatchFromAddressLine1: from?.addressLine1 ?? null,
    dispatchFromAddressLine2: from?.addressLine2 ?? null,
    dispatchFromCity: from?.city ?? null,
    dispatchFromState: from?.state ?? null,
    dispatchFromStateCode: from?.stateCode ?? null,
    dispatchFromPostalCode: from?.postalCode ?? null,
  };
}

async function readMovement(client: Client, taxInvoiceId: string): Promise<EwayBillMovementRecord> {
  const row = await client.ewayBillMovement.findUnique({
    where: { taxInvoiceId },
    include: { updatedBy: userSelect },
  });
  return {
    taxInvoiceId,
    version: row?.version ?? 0,
    captured: row !== null,
    movement: toMovementInfo(row),
    updatedAt: row ? row.updatedAt.toISOString() : null,
    updatedBy: row ? row.updatedBy : null,
  };
}

// Reads only live snapshot columns. A legacy invoice (null document snapshot,
// payable total or line GST) loads fine: every nullable value is passed through
// as null for the evaluator to report as a typed blocker, never an exception.
// Deliberately never joins ErveDispatch / ErvePackingList.
async function loadSnapshotWith(client: Client, taxInvoiceId: string): Promise<EwayBillSnapshot | null> {
  const invoice = await client.taxInvoice.findUnique({
    where: { id: taxInvoiceId },
    select: {
      id: true,
      status: true,
      invoiceNumber: true,
      finalizedAt: true,
      purchaseMode: true,
      sellerEinvoiceApplicable: true,
      gstTreatment: true,
      subtotal: true,
      totalCgst: true,
      totalSgst: true,
      totalIgst: true,
      payableTotal: true,
      roundOffAdjustment: true,
      documentSnapshot: true,
      sellerLegalName: true,
      sellerTradeName: true,
      sellerGstin: true,
      sellerStateCode: true,
      sellerPostalCode: true,
      sellerAddressLine1: true,
      sellerAddressLine2: true,
      sellerCity: true,
      billToName: true,
      billToGstin: true,
      billToStateCode: true,
      billToPostalCode: true,
      shipToAddressLine1: true,
      shipToAddressLine2: true,
      shipToCity: true,
      shipToState: true,
      shipToPostalCode: true,
      lines: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, quantity: true, hsnCode: true, taxableValue: true, gstPercent: true },
      },
      ewayBillMovement: { include: { updatedBy: userSelect } },
      ewayBills: {
        select: {
          id: true,
          source: true,
          status: true,
          integrationMode: true,
          verificationStatus: true,
          ewayBillNumber: true,
          generatedAt: true,
          validUntil: true,
        },
      },
      ewayBillAttempts: { select: { id: true, integrationMode: true, outcome: true } },
    },
  });
  if (!invoice) return null;

  const settings = await client.gstComplianceSettings.findUnique({
    where: { scope: APPLICATION_SCOPE },
    select: { version: true, integrationMode: true, ewayBillGenerationEnabled: true },
  });

  const document = readInvoiceDocumentSnapshot(invoice.documentSnapshot);
  const decimal = (value: Prisma.Decimal | null): string | null => value?.toString() ?? null;
  const movement = invoice.ewayBillMovement;

  const requestFacts: EwayBillRequestFacts = {
    invoice: {
      id: invoice.id,
      status: invoice.status,
      invoiceNumber: invoice.invoiceNumber,
      finalizedAt: invoice.finalizedAt,
      purchaseMode: invoice.purchaseMode,
      sellerEinvoiceApplicable: invoice.sellerEinvoiceApplicable,
      gstTreatment: invoice.gstTreatment,
      subtotal: decimal(invoice.subtotal),
      totalCgst: decimal(invoice.totalCgst),
      totalSgst: decimal(invoice.totalSgst),
      totalIgst: decimal(invoice.totalIgst),
      payableTotal: decimal(invoice.payableTotal),
      roundOffAdjustment: decimal(invoice.roundOffAdjustment),
      seller: {
        legalName: invoice.sellerLegalName,
        tradeName: invoice.sellerTradeName,
        gstin: invoice.sellerGstin,
        stateCode: invoice.sellerStateCode,
        postalCode: invoice.sellerPostalCode,
        addressLine1: invoice.sellerAddressLine1,
        addressLine2: invoice.sellerAddressLine2,
        city: invoice.sellerCity,
      },
      billTo: {
        name: invoice.billToName,
        gstin: invoice.billToGstin,
        stateCode: invoice.billToStateCode,
        postalCode: invoice.billToPostalCode,
      },
      shipTo: {
        addressLine1: invoice.shipToAddressLine1,
        addressLine2: invoice.shipToAddressLine2,
        city: invoice.shipToCity,
        state: invoice.shipToState,
        postalCode: invoice.shipToPostalCode,
      },
    },
    lines: invoice.lines.map((line) => {
      // Product name and description come from the ISSUED document snapshot,
      // never the live Style master; a legacy invoice has none -> null -> blocker.
      const style = document?.lines.find((item) => item.lineId === line.id)?.style ?? null;
      return {
        id: line.id,
        quantity: line.quantity,
        hsnCode: line.hsnCode,
        taxableValue: decimal(line.taxableValue),
        gstPercent: decimal(line.gstPercent),
        productName: style?.styleName ?? null,
        productDescription: style?.description ?? null,
      };
    }),
    movement: movement ? toMovementInfo(movement) : null,
    arrangement: null, // derived from the movement by the service
  };

  return {
    requestFacts,
    movementVersion: movement?.version ?? 0,
    bills: invoice.ewayBills,
    attempts: invoice.ewayBillAttempts,
    settings: {
      version: settings?.version ?? 0,
      integrationMode: settings?.integrationMode ?? 'DEMO',
      ewayBillGenerationEnabled: settings?.ewayBillGenerationEnabled ?? false,
    },
  };
}

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

function buildTx(client: Client, taxInvoiceId: string): EwayBillMutationTx {
  const readAttempt = async (attemptId: string): Promise<StoredEwayBillAttempt | null> => {
    const row = await client.ewayBillRequestAttempt.findUnique({
      where: { id: attemptId },
      include: attemptInclude,
    });
    return row ? { ...toAttemptView(row, new Date()), taxInvoiceId: row.taxInvoiceId } : null;
  };

  return {
    loadSnapshot: () => loadSnapshotWith(client, taxInvoiceId),
    getMovement: () => readMovement(client, taxInvoiceId),
    async liveNumberExists(ewayBillNumber) {
      const found = await client.ewayBill.findFirst({
        where: { integrationMode: 'LIVE', ewayBillNumber },
        select: { id: true },
      });
      return found !== null;
    },

    async saveMovement({ expectedVersion, movement, actorId }) {
      const columns = movementColumns(movement);
      if (expectedVersion === 0) {
        try {
          await client.ewayBillMovement.create({
            data: {
              id: createId(),
              taxInvoiceId,
              ...columns,
              createdById: actorId,
              updatedById: actorId,
            },
          });
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new HttpError(409, 'STALE_VERSION', 'E-Way Bill movement changed since it was loaded');
          }
          throw error;
        }
      } else {
        const updated = await client.ewayBillMovement.updateMany({
          where: { taxInvoiceId, version: expectedVersion },
          data: { ...columns, updatedById: actorId, version: { increment: 1 } },
        });
        if (updated.count !== 1) {
          throw new HttpError(409, 'STALE_VERSION', 'E-Way Bill movement changed since it was loaded');
        }
      }
      return readMovement(client, taxInvoiceId);
    },

    async createDemoAttempt(input) {
      try {
        const row = await client.ewayBillRequestAttempt.create({
          data: {
            id: createId(),
            taxInvoiceId,
            integrationMode: 'DEMO',
            actorId: input.actorId,
            outcome: 'PREPARED',
            documentType: input.documentType,
            documentNumber: input.documentNumber,
            documentDate: calendarDate(input.documentDate),
            requestFingerprint: input.requestFingerprint,
            settingsVersion: input.settingsVersion,
            movementVersion: input.movementVersion,
            reviewAfter: input.reviewAfter,
          },
          include: attemptInclude,
        });
        return toAttemptView(row, new Date());
      } catch (error) {
        // The partial unique index (one open attempt per invoice + mode) is the
        // last line of defence behind the service's own check.
        if (isUniqueViolation(error)) {
          throw HttpError.conflict('An E-Way Bill request for this invoice is already open', {
            reason: 'EWAY_BILL_ATTEMPT_ALREADY_OPEN',
          });
        }
        throw error;
      }
    },

    getAttempt: readAttempt,

    async transitionAttempt({ attemptId, from, to, patch }) {
      const result = await client.ewayBillRequestAttempt.updateMany({
        where: { id: attemptId, taxInvoiceId, outcome: { in: [...from] } },
        data: { outcome: to, ...patch },
      });
      return result.count === 1;
    },

    async createDemoBill(input) {
      try {
        const row = await client.ewayBill.create({
          data: {
            id: createId(),
            taxInvoiceId,
            source: 'PROVIDER_GENERATED',
            status: 'ACTIVE',
            integrationMode: 'DEMO',
            verificationStatus: 'SYNTHETIC_DEMO',
            ewayBillNumber: input.ewayBillNumber,
            generatedAt: input.generatedAt,
            validUntil: input.validUntil,
            providerName: 'GSTINAPI',
            providerReference: input.providerReference,
            requestAttemptId: input.attemptId,
            createdById: input.actorId,
          },
          include: billInclude,
        });
        return toBillView(row);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw HttpError.conflict('A Demo E-Way Bill already exists for this invoice', {
            reason: 'EWAY_BILL_DEMO_BILL_ALREADY_EXISTS',
          });
        }
        throw error;
      }
    },

    async createLinkedBill(input) {
      try {
        const row = await client.ewayBill.create({
          data: {
            id: createId(),
            taxInvoiceId,
            source: 'EXTERNALLY_LINKED',
            status: 'ACTIVE',
            integrationMode: 'LIVE',
            verificationStatus: 'UNVERIFIED_REFERENCE',
            ewayBillNumber: input.ewayBillNumber,
            createdById: input.actorId,
          },
          include: billInclude,
        });
        return toBillView(row);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw HttpError.conflict(
            'This E-Way Bill number is already recorded, or the invoice already has an active live E-Way Bill',
            { reason: 'EWAY_BILL_LINK_CONFLICT' },
          );
        }
        throw error;
      }
    },

    async audit({ actorId, action, metadata }) {
      await recordAuditLog(
        {
          actorId,
          action,
          entityType: EWAY_BILL_AUDIT_ENTITY,
          entityId: taxInvoiceId,
          metadata: metadata as Prisma.InputJsonValue,
        },
        client,
      );
    },
  };
}

export const ewayBillOperationsRepository: EwayBillOperationsRepository = {
  loadSnapshot: (taxInvoiceId) => loadSnapshotWith(prisma, taxInvoiceId),

  async getMovement(taxInvoiceId) {
    const exists = await prisma.taxInvoice.findUnique({ where: { id: taxInvoiceId }, select: { id: true } });
    return exists ? readMovement(prisma, taxInvoiceId) : null;
  },

  async listHistory(taxInvoiceId): Promise<EwayBillHistoryResponse | null> {
    const exists = await prisma.taxInvoice.findUnique({ where: { id: taxInvoiceId }, select: { id: true } });
    if (!exists) return null;
    const now = new Date();
    const [attempts, bills, events] = await Promise.all([
      prisma.ewayBillRequestAttempt.findMany({
        where: { taxInvoiceId },
        include: attemptInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: HISTORY_LIMIT,
      }),
      prisma.ewayBill.findMany({
        where: { taxInvoiceId },
        include: billInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: HISTORY_LIMIT,
      }),
      prisma.auditLog.findMany({
        where: { entityType: EWAY_BILL_AUDIT_ENTITY, entityId: taxInvoiceId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: HISTORY_LIMIT,
        select: {
          id: true,
          action: true,
          createdAt: true,
          metadata: true,
          actor: { select: { id: true, name: true } },
        },
      }),
    ]);
    return {
      taxInvoiceId,
      attempts: attempts.map((row) => toAttemptView(row, now)),
      ewayBills: bills.map(toBillView),
      events: events.map(
        (row): EwayBillAuditEvent => ({
          id: row.id,
          action: row.action,
          createdAt: row.createdAt.toISOString(),
          actor: row.actor,
          metadata:
            row.metadata !== null && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
              ? (row.metadata as Record<string, unknown>)
              : null,
        }),
      ),
    };
  },

  async withInvoiceLock(taxInvoiceId, work) {
    return prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${invoiceDocumentLockKey(taxInvoiceId)}))`;
        return work(buildTx(tx, taxInvoiceId));
      },
      { maxWait: 5000, timeout: 15000 },
    );
  },
};
