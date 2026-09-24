import type { JobOrderAuditEntry } from '@erve/types';
import { AuditTrail } from '@erve/app-components';
import { Panel } from '@erve/layout';
import type { JobOrder } from '../../types.js';
import { formatDateTime } from '../../job-order-ui.js';
import { formatJobOrderAuditTitle } from '../../job-order-audit.js';

export interface JobOrderHistoryTabProps {
  jobOrder: JobOrder;
  auditEntries: JobOrderAuditEntry[];
  auditLoading: boolean;
}

export function JobOrderHistoryTab({ jobOrder, auditEntries, auditLoading }: JobOrderHistoryTabProps) {
  return (
    <div className="space-y-4">
      <Panel title="Seasons">
        <div className="text-sm text-muted-foreground">
          {(jobOrder.seasonSnapshots ?? []).map((season) => season.displayName).join(', ') ||
            'No Season snapshot'}
        </div>
      </Panel>

      <Panel title="Audit Log">
        <AuditTrail
          items={auditEntries.map((entry) => ({
            id: entry.id,
            title: formatJobOrderAuditTitle(entry.action, entry.metadata),
            actor: entry.actor?.name ?? 'System',
            timestamp: formatDateTime(entry.createdAt),
          }))}
          emptyState={auditLoading ? 'Loading history…' : 'No history available.'}
        />
      </Panel>

      <Panel title="Factory acknowledgement evidence">
        {jobOrder.acknowledgement ? (
          <div className="space-y-3 text-sm">
            <p>
              Acknowledged by <strong>{jobOrder.acknowledgement.acknowledgedBy.name}</strong> at{' '}
              {formatDateTime(jobOrder.acknowledgement.acknowledgedAt)} (revision{' '}
              {jobOrder.acknowledgement.disclaimerRevision}).
            </p>
            <p className="break-all text-muted-foreground">
              SHA-256: {jobOrder.acknowledgement.disclaimerSha256}
            </p>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 font-sans">
              {jobOrder.acknowledgement.disclaimerTextSnapshot}
            </pre>
          </div>
        ) : jobOrder.historicalImport ? (
          <p className="text-sm text-muted-foreground">
            Not applicable — this is a historical imported Job Order. No live factory acknowledgement or
            confirmation was recorded for it.
          </p>
        ) : jobOrder.status === 'DRAFT' ? (
          <p className="text-sm text-muted-foreground">
            No acknowledgement is required while this Job Order is a draft.
          </p>
        ) : jobOrder.confirmedAt ? (
          <p className="text-sm text-muted-foreground">
            No recorded disclaimer acknowledgement. This Job Order predates the factory acknowledgement
            workflow.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Factory acknowledgement is pending. Waiting for the factory to acknowledge this Job Order.
          </p>
        )}
      </Panel>
    </div>
  );
}
