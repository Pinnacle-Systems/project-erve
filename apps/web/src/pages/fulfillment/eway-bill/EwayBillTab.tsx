import { canManageEwayBill } from '@erve/shared';
import { useAuth } from '../../../auth/AuthContext.js';
import { EwayBillGenerationSection } from './EwayBillGenerationSection.js';
import { EwayBillHistorySection } from './EwayBillHistorySection.js';
import { EwayBillMovementSection } from './EwayBillMovementSection.js';
import { EwayBillStatusSection } from './EwayBillStatusSection.js';
import {
  useEwayBillActions,
  useEwayBillHistory,
  useEwayBillMovement,
  useEwayBillPreview,
  useEwayBillReadiness,
} from './eway-bill-queries.js';
import { hasOpenAttempt } from './eway-bill-ui.js';

interface Props {
  invoiceId: string;
  invoiceStatus: 'DRAFT' | 'FINALIZED' | 'CANCELLED';
  invoiceNumber: string | null;
}

/**
 * The Tax Invoice "E-Way Bill" tab. Mounted only for ADMIN and ACCOUNTANT, and
 * only once opened, so no E-Way Bill request is made before then;
 * ADMIN sees every section read-only. Operations are the B2B endpoints: this
 * component holds no business rules beyond enabling or disabling controls
 * from what the backend reports.
 */
export function EwayBillTab({ invoiceId, invoiceStatus, invoiceNumber }: Props) {
  const { user } = useAuth();
  const canManage = !!user && canManageEwayBill(user);

  const readiness = useEwayBillReadiness(invoiceId, true);
  const movement = useEwayBillMovement(invoiceId, true);
  const preview = useEwayBillPreview(invoiceId, true);
  const history = useEwayBillHistory(invoiceId, true);
  const { saveMovement, generateDemo, linkExisting, closeDemoAttempt } =
    useEwayBillActions(invoiceId);

  const attempts = history.data?.attempts;
  const openAttempt = attempts ? hasOpenAttempt(attempts) : false;

  const readOnlyReason = !canManage
    ? 'View only — an Accountant maintains movement information.'
    : invoiceStatus === 'CANCELLED'
      ? 'This Tax Invoice is cancelled, so its movement information can no longer change.'
      : openAttempt
        ? 'An E-Way Bill request for this invoice is unfinished. Resolve it in the attempt history below before changing movement information.'
        : history.isPending
          ? 'Checking for unfinished E-Way Bill requests…'
          : null;

  return (
    <div className="space-y-4">
      <EwayBillStatusSection
        invoiceStatus={invoiceStatus}
        invoiceNumber={invoiceNumber}
        readiness={readiness.data}
        readinessLoading={readiness.isPending}
        preview={preview.data}
        attempts={attempts}
      />
      <EwayBillMovementSection
        query={movement}
        readOnlyReason={readOnlyReason}
        save={saveMovement}
      />
      <EwayBillGenerationSection
        query={preview}
        canManage={canManage}
        hasOpenAttempt={openAttempt}
        refreshing={preview.isFetching || history.isFetching}
        generate={generateDemo}
      />
      <EwayBillHistorySection
        invoiceStatus={invoiceStatus}
        canManage={canManage}
        query={history}
        linkage={readiness.data?.linkage ?? preview.data?.linkage}
        link={linkExisting}
        closeDemo={closeDemoAttempt}
      />
    </div>
  );
}
