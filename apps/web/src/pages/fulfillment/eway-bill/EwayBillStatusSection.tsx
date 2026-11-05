import type {
  EwayBillAssociationSummary,
  EwayBillAttemptView,
  EwayBillGenerationPreviewResponse,
  EwayBillReadinessResponse,
} from '@erve/types';
import { StatusBadge } from '@erve/app-components';
import { ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { LoadingState } from '@erve/data-display';
import { VerificationBadge } from './EwayBillBadges.js';
import { APPLICABILITY_LABEL, hasOpenAttempt } from './eway-bill-ui.js';

interface Props {
  invoiceStatus: 'DRAFT' | 'FINALIZED' | 'CANCELLED';
  invoiceNumber: string | null;
  readiness: EwayBillReadinessResponse | undefined;
  readinessLoading: boolean;
  preview: EwayBillGenerationPreviewResponse | undefined;
  attempts: readonly EwayBillAttemptView[] | undefined;
}

const INVOICE_STATUS: Record<Props['invoiceStatus'], { label: string; tone: 'warning' | 'success' | 'cancelled' }> = {
  DRAFT: { label: 'Draft', tone: 'warning' },
  FINALIZED: { label: 'Finalized', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'cancelled' },
};

function BillSummary({ bill }: { bill: EwayBillAssociationSummary }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-medium tabular-nums">{bill.ewayBillNumber}</span>
      <VerificationBadge status={bill.verificationStatus} />
    </span>
  );
}

export function EwayBillStatusSection({
  invoiceStatus,
  invoiceNumber,
  readiness,
  readinessLoading,
  preview,
  attempts,
}: Props) {
  const status = INVOICE_STATUS[invoiceStatus];
  const linkage = readiness?.linkage ?? preview?.linkage;
  const applicability = readiness?.applicability ?? preview?.applicability;
  const liveBill = linkage?.ewayBill ?? linkage?.unverifiedReference ?? null;
  const openCount = attempts
    ? attempts.filter((attempt) => attempt.open).length
    : (linkage?.syntheticRecords.openDemoAttempts ?? 0);
  const unresolved = attempts ? hasOpenAttempt(attempts) : openCount > 0;
  const requestReady = preview ? preview.request.ready : readiness?.readiness.outcome === 'READY';

  return (
    <Panel title="E-Way Bill status">
      {readinessLoading && !readiness ? (
        <LoadingState label="Loading E-Way Bill status" />
      ) : (
        <div className="space-y-4">
          <DescriptionList columns={3}>
            <DescriptionList.Item
              label="Invoice"
              value={
                <span className="flex flex-wrap items-center gap-2">
                  <span>{invoiceNumber ?? 'Number not allocated'}</span>
                  <StatusBadge label={status.label} tone={status.tone} />
                </span>
              }
            />
            <DescriptionList.Item
              label="E-Way Bill applicability"
              value={applicability ? APPLICABILITY_LABEL[applicability.outcome] : 'Unavailable'}
            />
            <DescriptionList.Item
              label="Request readiness"
              value={
                preview || readiness ? (
                  <StatusBadge
                    label={requestReady ? 'Ready' : 'Blocked'}
                    tone={requestReady ? 'success' : 'warning'}
                  />
                ) : (
                  'Unavailable'
                )
              }
            />
            <DescriptionList.Item
              label="Demo generation"
              value={
                preview
                  ? preview.demo.available
                    ? 'Available'
                    : 'Not available'
                  : readiness?.capabilities.demoGenerationAvailable
                    ? 'Enabled on this server'
                    : 'Not available'
              }
            />
            <DescriptionList.Item
              label="Demo E-Way Bill"
              value={
                linkage?.syntheticRecords.demoBill ? (
                  <BillSummary bill={linkage.syntheticRecords.demoBill} />
                ) : (
                  'None'
                )
              }
            />
            <DescriptionList.Item
              label="Existing live reference"
              value={liveBill ? <BillSummary bill={liveBill} /> : 'None'}
            />
            <DescriptionList.Item
              label="Unresolved attempts"
              value={
                unresolved
                  ? `${openCount || 1} unfinished request${openCount > 1 ? 's' : ''}`
                  : 'None'
              }
            />
            <DescriptionList.Item
              label="Statutory verification"
              value={
                linkage?.satisfiesStatutoryClearance
                  ? 'Provider-verified E-Way Bill on record'
                  : 'No provider-verified E-Way Bill on record'
              }
            />
          </DescriptionList>
          {!linkage?.satisfiesStatutoryClearance && (
            <p className="text-sm text-muted-foreground">
              Demo E-Way Bills are synthetic and a manually linked number is not verified; neither
              is treated as statutory clearance.
            </p>
          )}
          {applicability?.outcome === 'UNDETERMINED' &&
            applicability.reasons.map((reason) => (
              <p key={reason.code} className="text-sm text-muted-foreground">
                {reason.message}
              </p>
            ))}
          {readiness?.reviewFlags.map((flag) => (
            <ValidationMessage key={flag.code} tone="warning">
              {flag.message}
            </ValidationMessage>
          ))}
        </div>
      )}
    </Panel>
  );
}
