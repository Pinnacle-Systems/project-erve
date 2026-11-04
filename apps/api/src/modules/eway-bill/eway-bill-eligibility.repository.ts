import type { EwayBillMovementInfo } from '@erve/types';
import { prisma } from '../../db/prisma.js';
import type { EwayBillFacts } from './eway-bill-eligibility.js';
import type { EwayBillFactsRepository } from './eway-bill-eligibility.service.js';

const APPLICATION_SCOPE = 'APPLICATION';

const isoDate = (value: Date | null): string | null =>
  value ? value.toISOString().slice(0, 10) : null;

// Read-only: one invoice, its lines, and the E-Way Bill tables. Deliberately
// does not join ErvePackingList/ErveDispatch — readiness must not depend on
// the physical-dispatch record. Legacy invoices (null documentSnapshot /
// payableTotal) load fine: only live snapshot columns are read, and every
// nullable value is passed through as null for the evaluator to report.
export const ewayBillFactsRepository: EwayBillFactsRepository = {
  async loadFacts(taxInvoiceId): Promise<EwayBillFacts | null> {
    const invoice = await prisma.taxInvoice.findUnique({
      where: { id: taxInvoiceId },
      select: {
        id: true,
        status: true,
        invoiceNumber: true,
        finalizedAt: true,
        gstTreatment: true,
        subtotal: true,
        totalCgst: true,
        totalSgst: true,
        totalIgst: true,
        sellerGstin: true,
        sellerStateCode: true,
        sellerPostalCode: true,
        billToGstin: true,
        billToStateCode: true,
        billToPostalCode: true,
        shipToState: true,
        shipToPostalCode: true,
        lines: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, quantity: true, hsnCode: true, taxableValue: true },
        },
        ewayBillMovement: true,
        ewayBills: {
          select: {
            id: true,
            source: true,
            status: true,
            integrationMode: true,
            ewayBillNumber: true,
            generatedAt: true,
            validUntil: true,
          },
        },
        ewayBillAttempts: { select: { id: true, integrationMode: true, outcome: true } },
      },
    });
    if (!invoice) return null;

    const settings = await prisma.gstComplianceSettings.findUnique({
      where: { scope: APPLICATION_SCOPE },
      select: { ewayBillGenerationEnabled: true },
    });

    const m = invoice.ewayBillMovement;
    const movement: EwayBillMovementInfo | null = m
      ? {
          transportMode: m.transportMode,
          vehicleNumber: m.vehicleNumber,
          vehicleType: m.vehicleType,
          transporterId: m.transporterId,
          transporterName: m.transporterName,
          transportDocumentNumber: m.transportDocumentNumber,
          transportDocumentDate: isoDate(m.transportDocumentDate),
          approximateDistanceKm: m.approximateDistanceKm,
          dispatchFrom:
            m.dispatchFromAddressLine1 ||
            m.dispatchFromCity ||
            m.dispatchFromState ||
            m.dispatchFromStateCode ||
            m.dispatchFromPostalCode
              ? {
                  addressLine1: m.dispatchFromAddressLine1,
                  addressLine2: m.dispatchFromAddressLine2,
                  city: m.dispatchFromCity,
                  state: m.dispatchFromState,
                  stateCode: m.dispatchFromStateCode,
                  postalCode: m.dispatchFromPostalCode,
                }
              : null,
        }
      : null;

    return {
      invoice: {
        id: invoice.id,
        status: invoice.status,
        invoiceNumber: invoice.invoiceNumber,
        finalizedAt: invoice.finalizedAt,
        gstTreatment: invoice.gstTreatment,
        subtotal: invoice.subtotal?.toString() ?? null,
        totalCgst: invoice.totalCgst?.toString() ?? null,
        totalSgst: invoice.totalSgst?.toString() ?? null,
        totalIgst: invoice.totalIgst?.toString() ?? null,
        seller: {
          gstin: invoice.sellerGstin,
          stateCode: invoice.sellerStateCode,
          postalCode: invoice.sellerPostalCode,
        },
        billTo: {
          gstin: invoice.billToGstin,
          stateCode: invoice.billToStateCode,
          postalCode: invoice.billToPostalCode,
        },
        shipTo: { state: invoice.shipToState, postalCode: invoice.shipToPostalCode },
      },
      lines: invoice.lines.map((line) => ({
        id: line.id,
        quantity: line.quantity,
        hsnCode: line.hsnCode,
        taxableValue: line.taxableValue?.toString() ?? null,
      })),
      movement,
      bills: invoice.ewayBills,
      attempts: invoice.ewayBillAttempts,
      settings: { ewayBillGenerationEnabled: settings?.ewayBillGenerationEnabled ?? false },
    };
  },
};
