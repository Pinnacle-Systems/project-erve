import { useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { AuditTrail, PageHeader, StatusBadge } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { DataTable, EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import { useAuth } from '../../auth/AuthContext.js';
import { canMutateDispatchOrders, canViewDispatchOrderAudit, canViewErveDispatches, canViewFactoryDispatches } from '../../auth/permissions.js';
import type { ErveDispatchView, FactoryDispatchSummary, PaginatedResult } from '../fulfillment/types.js';
import type { DispatchOrderFulfillmentStage, SaleOrder, SaleOrderAuditEntry } from './types.js';

const FULFILLMENT_STAGE_LABELS: Record<DispatchOrderFulfillmentStage, string> = {
  AWAITING_PACKING: 'Awaiting Packing',
  PACKING_IN_PROGRESS: 'Packing in Progress',
  FACTORY_DISPATCHED: 'Factory Dispatched',
  ERVE_DISPATCHED: 'Erve Dispatched',
  DELIVERED: 'Delivered',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function SaleOrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const canEdit = canMutateDispatchOrders(user);
  const canSeeAudit = canViewDispatchOrderAudit(user);
  const canSeeFactoryDispatches = canViewFactoryDispatches(user);
  const canSeeErveDispatches = canViewErveDispatches(user);

  const soQuery = useQuery({
    queryKey: ['sale-order', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<SaleOrder>>(`/sale-orders/${id}`);
      return res.data.data;
    },
  });
  const so = soQuery.data;

  const auditQuery = useQuery({
    queryKey: ['sale-order-audit', id],
    enabled: Boolean(so) && canSeeAudit,
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<SaleOrderAuditEntry[]>>(`/sale-orders/${id}/audit`);
      return res.data.data;
    },
  });

  const factoryDispatchesQuery = useQuery({
    queryKey: ['factory-dispatches', 'for-sale-order', id],
    enabled: canSeeFactoryDispatches && Boolean(so),
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResult<FactoryDispatchSummary>>>('/factory-dispatches', {
        params: { saleOrderId: id, limit: 50 },
      });
      return res.data.data.items;
    },
  });

  const erveDispatchesQuery = useQuery({
    queryKey: ['erve-dispatches', 'for-sale-order', id],
    enabled: canSeeErveDispatches && Boolean(so),
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResult<ErveDispatchView>>>('/erve-dispatches', {
        params: { saleOrderId: id, limit: 50 },
      });
      return res.data.data.items;
    },
  });

  const generateDispatchOrderDetailPdf = useCallback(async () => {
    if (!so) throw new Error('Dispatch order not loaded');
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generateDispatchOrderDetailPdfBlob } = await import('../fulfillment/pdf/dispatch-order/generateDispatchOrderDetailPdf.js');
    return generateDispatchOrderDetailPdfBlob(
      so,
      {
        factoryDispatches: canSeeFactoryDispatches ? (factoryDispatchesQuery.data ?? []) : null,
        erveDispatches: canSeeErveDispatches ? (erveDispatchesQuery.data ?? []) : null,
        auditTrail: canSeeAudit ? (auditQuery.data ?? []) : null,
      },
      { generatedAt: new Date().toISOString(), generatedBy: user?.name },
    );
  }, [so, canSeeFactoryDispatches, factoryDispatchesQuery.data, canSeeErveDispatches, erveDispatchesQuery.data, canSeeAudit, auditQuery.data, user?.name]);

  const pdfAction = usePdfAction({
    generate: generateDispatchOrderDetailPdf,
    filename: () => buildPdfFilename(['ERVE-Dispatch-Order', so?.saleOrderNumber]),
  });

  if (soQuery.isLoading) return <LoadingState label="Loading dispatch order" />;
  if (soQuery.isError || !so) {
    return <EmptyState title="Unable to load this dispatch order" tone="error" />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={so.saleOrderNumber}
        subtitle={`${so.distributors.map((d) => d.name).join(', ')} — ${so.factory.name}`}
        secondaryActions={
          <div className="flex items-center gap-2">
            <PdfActionButtons
              isGenerating={pdfAction.isGenerating}
              error={pdfAction.error}
              onDownload={pdfAction.handleDownload}
              onPrint={pdfAction.handlePrint}
            />
            {canSeeFactoryDispatches && (
              <Button asChild variant="secondary">
                <Link to={`/sale-orders/${so.id}/packing-list`}>Packing List</Link>
              </Button>
            )}
            {canEdit && !so.isLocked && (
              <Button asChild>
                <Link to={`/sale-orders/${so.id}/edit`}>Edit / Correct</Link>
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
              Back
            </Button>
          </div>
        }
      />

      <Panel title="Header">
        <DescriptionList>
          <DescriptionList.Item
            label={so.distributors.length === 1 ? 'Distributor' : `Distributors (${so.distributors.length})`}
            value={so.distributors.map((d) => d.name).join(', ') || '—'}
          />
          <DescriptionList.Item label="Factory" value={so.factory.name} />
          <DescriptionList.Item label="Dispatch Order Date" value={formatDate(so.soDate)} />
          <DescriptionList.Item label="Financial Year" value={so.financialYear.code} />
          <DescriptionList.Item label="Created By" value={so.creator.name} />
          <DescriptionList.Item label="Created At" value={formatDate(so.createdAt)} />
          <DescriptionList.Item label="Remarks" value={so.remarks ?? '—'} />
          <DescriptionList.Item
            label="State"
            value={
              so.isLocked ? (
                <StatusBadge label="Factory Dispatched (locked)" tone="approved" />
              ) : (
                <StatusBadge label="Ready for Factory (editable)" tone="pending" />
              )
            }
          />
          <DescriptionList.Item
            label="Fulfillment"
            value={<StatusBadge label={FULFILLMENT_STAGE_LABELS[so.fulfillment.stage]} tone="approved" />}
          />
        </DescriptionList>
      </Panel>

      <Panel title="Distributors">
        <div className="space-y-5">
          {so.distributorGroups.map((group) => {
            const groupTotal = group.lines.reduce((sum, line) => sum + line.quantity, 0);
            return (
              <div key={group.id} className="rounded border border-[var(--erp-border-default)] p-3">
                <div className="mb-3 flex items-center justify-between">
                  <div className="font-medium">{group.distributor.name}</div>
                  <div className="flex items-center gap-3 text-sm text-[var(--erp-text-muted)]">
                    <span>Purchase Mode: {group.purchaseMode}</span>
                    <span>Total: {groupTotal.toLocaleString()}</span>
                  </div>
                </div>
                <div className="space-y-4 pl-3">
                  {group.destinations.map((dest) => {
                    const destLines = group.lines.filter((line) => line.destinationId === dest.id);
                    const destTotal = destLines.reduce((sum, line) => sum + line.quantity, 0);
                    return (
                      <div key={dest.id} className="rounded border border-[var(--erp-border-default)] p-3">
                        <div className="flex items-center justify-between">
                          <div className="font-medium">{dest.label || dest.city}</div>
                          <div className="text-sm text-[var(--erp-text-muted)]">Total: {destTotal.toLocaleString()}</div>
                        </div>
                        <div className="text-sm text-[var(--erp-text-muted)]">
                          {[dest.addressLine1, dest.addressLine2, dest.city, dest.state, dest.postalCode, dest.country]
                            .filter(Boolean)
                            .join(', ')}
                        </div>
                        {(dest.contactName || dest.contactPhone) && (
                          <div className="text-sm text-[var(--erp-text-muted)]">
                            {[dest.contactName, dest.contactPhone].filter(Boolean).join(' · ')}
                          </div>
                        )}
                        {dest.gstin && <div className="text-sm text-[var(--erp-text-muted)]">GSTIN: {dest.gstin}</div>}
                        <DataTable
                          rowKey="id"
                          data={destLines}
                          columns={[
                            { key: 'style', header: 'Style', render: (l) => `${l.styleNumber} — ${l.styleName}` },
                            { key: 'size', header: 'Size', accessor: 'sizeLabel' },
                            { key: 'quantity', header: 'Quantity', align: 'right', render: (l) => l.quantity.toLocaleString() },
                          ]}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="Style / Size Totals">
        <DataTable
          rowKey="key"
          data={Object.values(
            so.lines.reduce<Record<string, { key: string; styleNumber: string; styleName: string; sizeLabel: string; quantity: number }>>(
              (acc, line) => {
                const key = `${line.styleId}:${line.sizeId}`;
                if (!acc[key]) {
                  acc[key] = { key, styleNumber: line.styleNumber, styleName: line.styleName, sizeLabel: line.sizeLabel, quantity: 0 };
                }
                acc[key]!.quantity += line.quantity;
                return acc;
              },
              {},
            ),
          )}
          columns={[
            { key: 'style', header: 'Style', render: (r) => `${r.styleNumber} — ${r.styleName}` },
            { key: 'size', header: 'Size', accessor: 'sizeLabel' },
            { key: 'quantity', header: 'Total Quantity', align: 'right', render: (r) => r.quantity.toLocaleString() },
          ]}
        />
        <div className="mt-2 text-right text-sm font-medium">Total: {so.totalQuantity.toLocaleString()}</div>
      </Panel>

      {(canSeeFactoryDispatches || canSeeErveDispatches) && (
        <Panel title="Factory / Erve Dispatch Records">
          <div className="grid gap-4 md:grid-cols-2">
            {canSeeFactoryDispatches && (
              <div>
                <h4 className="mb-2 text-sm font-medium">Factory Dispatches</h4>
                {(factoryDispatchesQuery.data ?? []).length === 0 ? (
                  <p className="text-sm text-[var(--erp-text-muted)]">None yet.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {factoryDispatchesQuery.data!.map((fd) => (
                      <li key={fd.id}>
                        <Link className="text-[var(--erp-text-link)]" to={`/fulfillment/factory-dispatches/${fd.id}`}>
                          {fd.factoryDispatchNumber}
                        </Link>{' '}
                        — {fd.status === 'READY_FOR_ERVE' ? 'Ready for Erve' : 'Draft'}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {canSeeErveDispatches && (
              <div>
                <h4 className="mb-2 text-sm font-medium">Erve Dispatches</h4>
                {(erveDispatchesQuery.data ?? []).length === 0 ? (
                  <p className="text-sm text-[var(--erp-text-muted)]">None yet.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {erveDispatchesQuery.data!.map((ed) => (
                      <li key={ed.id}>
                        <Link className="text-[var(--erp-text-link)]" to={`/fulfillment/erve-dispatches/${ed.id}`}>
                          {ed.erveDispatchNumber}
                        </Link>{' '}
                        — {ed.status} ({ed.totalQuantity.toLocaleString()})
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </Panel>
      )}

      {canSeeAudit && (
        <Panel title="Audit Trail">
          <AuditTrail
            items={(auditQuery.data ?? []).map((entry) => ({
              id: entry.id,
              title: entry.title,
              description: entry.detail ?? undefined,
              actor: entry.actor?.name,
              timestamp: formatDate(entry.createdAt),
            }))}
            emptyState={auditQuery.isLoading ? 'Loading…' : 'No audit events yet.'}
          />
        </Panel>
      )}
    </div>
  );
}
