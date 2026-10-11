import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { isAxiosError } from 'axios';
import type { TaxInvoiceLineView, TaxInvoiceReviewView, TaxInvoiceAddress } from '@erve/types';
import { PageHeader, StatusBadge, ConfirmDialog, AuditTrail } from '@erve/app-components';
import {
  Button,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  ValidationMessage,
} from '@erve/primitives';
import { Panel, DescriptionList } from '@erve/layout';
import { LoadingState, EmptyState, ErrorState } from '@erve/data-display';
import { useAuth } from '../../auth/AuthContext.js';
import {
  canMutateTaxInvoices,
  canViewTaxInvoices,
  canViewErvePackingLists,
  canViewErveDispatches,
} from '../../auth/permissions.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import {
  useTaxInvoiceReview,
  useTaxInvoiceAudit,
  useTaxInvoiceActions,
} from './tax-invoice-queries.js';
import {
  formatInvoiceDate,
  formatInvoiceMoney,
  formatInvoiceTimestamp,
  invoiceAuditTitle,
} from './tax-invoice-ui.js';
import { TaxInvoiceLines } from './TaxInvoiceLines.js';
import { TaxInvoiceTotals } from './TaxInvoiceTotals.js';
import { TaxInvoiceOverrideDialog } from './TaxInvoiceOverrideDialog.js';

const addressText = (address: TaxInvoiceAddress) =>
  [
    address.addressLine1,
    address.addressLine2,
    address.city,
    address.state,
    address.postalCode,
    address.country,
  ]
    .filter(Boolean)
    .join(', ') || 'Address not snapshotted';
const financialReviewKey = (invoice: TaxInvoiceReviewView) =>
  JSON.stringify([
    invoice.lines.map((line) => [
      line.id,
      line.quantity,
      line.hsn?.code,
      line.finalUnitRate,
      line.gstPercent,
      line.taxableValue,
      line.cgstAmount,
      line.sgstAmount,
      line.igstAmount,
    ]),
    invoice.grandTotal,
    invoice.payableTotal,
  ]);

export function TaxInvoiceDetailPage() {
  const { id } = useParams();
  const query = useTaxInvoiceReview(id);
  if (query.isLoading) return <LoadingState label="Loading Tax Invoice" />;
  if (!query.data && query.isError)
    return isAxiosError(query.error) && query.error.response?.status === 404 ? (
      <EmptyState title="Tax Invoice not found" tone="error" />
    ) : (
      <ErrorState
        title="Unable to load Tax Invoice"
        description={getApiErrorMessage(query.error, 'Try loading this invoice again.')}
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Retry
          </Button>
        }
      />
    );
  if (!query.data) return <EmptyState title="Tax Invoice not found" tone="error" />;
  return (
    <TaxInvoiceDetail
      key={query.data.id}
      invoice={query.data}
      refreshError={query.isError}
      refreshing={query.isFetching}
      refresh={async () => {
        const result = await query.refetch();
        if (result.isError) throw result.error;
        return result.data;
      }}
    />
  );
}

function TaxInvoiceDetail({
  invoice,
  refreshError,
  refreshing,
  refresh,
}: {
  invoice: TaxInvoiceReviewView;
  refreshError: boolean;
  refreshing: boolean;
  refresh: () => Promise<TaxInvoiceReviewView | undefined>;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tab, setTab] = useState('review');
  const [editing, setEditing] = useState<TaxInvoiceLineView | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const actions = useTaxInvoiceActions(invoice.id);
  const audit = useTaxInvoiceAudit(invoice.id, tab === 'history');
  const mutable = canMutateTaxInvoices(user) && invoice.status === 'DRAFT';
  const busy = actions.override.isPending || actions.finalize.isPending || verifying;
  const canPrint = canViewTaxInvoices(user) && invoice.status === 'FINALIZED';
  const pdfActions = usePdfAction({
    generate: async () => {
      if (!canPrint) throw new Error('Issued invoice read permission is required');
      const { generateTaxInvoicePdfBlob } =
        await import('./pdf/tax-invoice/generateTaxInvoicePdf.js');
      return generateTaxInvoicePdfBlob(invoice);
    },
    filename: () => buildPdfFilename(['ERVE-Tax-Invoice', invoice.invoiceNumber]),
  });
  async function finalize() {
    setVerifying(true);
    setError('');
    try {
      const latest = await refresh();
      if (!latest) throw new Error('Invoice review could not be refreshed.');
      if (latest.status === 'FINALIZED') {
        setConfirm(false);
        return;
      }
      if (
        latest.review.state !== 'READY' ||
        financialReviewKey(latest) !== financialReviewKey(invoice)
      ) {
        setConfirm(false);
        setError(
          'Review values or prerequisites changed. Review the refreshed invoice before finalizing.',
        );
        return;
      }
      await actions.finalize.mutateAsync();
      setConfirm(false);
    } catch (caught) {
      setError(getApiErrorMessage(caught, 'Unable to finalize this invoice.'));
      setConfirm(false);
    } finally {
      setVerifying(false);
    }
  }
  return (
    <div className="space-y-4">
      <PageHeader
        className="[&>div]:flex-col [&>div]:items-stretch sm:[&>div]:flex-row sm:[&>div]:items-start [&_h1]:break-words max-sm:[&>div>div:last-child]:flex-wrap"
        title={invoice.invoiceNumber ?? `Draft · ${invoice.ervePackingList.ervePackingListNumber}`}
        subtitle={`${invoice.billTo.name} · ${invoice.shipTo.label ?? 'Destination not snapshotted'}`}
        status={
          <StatusBadge
            label={invoice.status === 'DRAFT' ? 'Draft' : 'Finalized'}
            tone={invoice.status === 'DRAFT' ? 'warning' : 'success'}
          />
        }
        primaryAction={
          mutable ? (
            <Button
              onClick={() => setConfirm(true)}
              disabled={
                invoice.review.state !== 'READY' ||
                busy ||
                refreshing ||
                refreshError ||
                editing !== null
              }
              loading={busy}
            >
              Finalize invoice
            </Button>
          ) : undefined
        }
        secondaryActions={
          <>
            <Button variant="secondary" onClick={() => navigate('/fulfillment/tax-invoices')}>
              Back to invoices
            </Button>
            {canPrint && (
              <PdfActionButtons
                isGenerating={pdfActions.isGenerating}
                error={pdfActions.error}
                onDownload={() => void pdfActions.handleDownload()}
                onPrint={() => void pdfActions.handlePrint()}
                disabled={
                  !invoice.invoiceNumber || !invoice.finalizedAt || invoice.grandTotal === null
                }
                disabledHint="Issued identity and financial total are required for the PDF."
              />
            )}
          </>
        }
      />
      {refreshError && (
        <ErrorState
          title="Unable to refresh Tax Invoice"
          description="Previously loaded data is retained. Refresh successfully before taking a financial action."
          action={
            <Button variant="secondary" onClick={() => void refresh().catch(() => undefined)}>
              Retry
            </Button>
          }
        />
      )}
      {error && <ValidationMessage tone="error">{error}</ValidationMessage>}
      {invoice.review.isPreview && (
        <ValidationMessage tone="warning">
          Preview · Backend-calculated values for review. No EI number or issued financial snapshot
          exists until finalization.
        </ValidationMessage>
      )}
      {invoice.review.blockers.map((blocker) => (
        <ValidationMessage key={blocker.code} tone="error">
          {blocker.message} ({blocker.code})
        </ValidationMessage>
      ))}
      <Panel title="Document and source context">
        <DescriptionList columns={4}>
          <DescriptionList.Item
            label="Invoice date"
            value={formatInvoiceDate(invoice.finalizedAt)}
          />
          <DescriptionList.Item
            label="Purchase mode"
            value={invoice.purchaseMode === 'SALE_RETURN' ? 'Sale or return' : 'Outright'}
          />
          <DescriptionList.Item
            label="EIPL"
            value={
              canViewErvePackingLists(user) ? (
                <Link to={`/fulfillment/erve-packing-lists/${invoice.ervePackingList.id}`}>
                  {invoice.ervePackingList.ervePackingListNumber}
                </Link>
              ) : (
                invoice.ervePackingList.ervePackingListNumber
              )
            }
          />
          <DescriptionList.Item
            label="Dispatch Orders"
            value={
              invoice.documentSnapshot?.dispatchOrders.map((order) => order.number).join(', ') ||
              'Issued order provenance unavailable'
            }
          />
          <DescriptionList.Item
            label="LR / transporter"
            value={
              invoice.documentSnapshot?.transport
                ? [
                    invoice.documentSnapshot.transport.lrNumber,
                    invoice.documentSnapshot.transport.transporter,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Not recorded at issue'
                : 'Not recorded at issue'
            }
          />
          {invoice.documentSnapshot?.historicalBuyerOrderReference && (
            <DescriptionList.Item
              label="Historical EISO"
              value={invoice.documentSnapshot.historicalBuyerOrderReference.value}
            />
          )}
          <DescriptionList.Item
            label="Erve Dispatch"
            value={
              invoice.erveDispatch ? (
                canViewErveDispatches(user) ? (
                  <Link to={`/fulfillment/erve-dispatches/${invoice.erveDispatch.id}`}>
                    {invoice.erveDispatch.erveDispatchNumber}
                  </Link>
                ) : (
                  invoice.erveDispatch.erveDispatchNumber
                )
              ) : (
                'Not recorded'
              )
            }
          />
        </DescriptionList>
      </Panel>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="review">Review</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="review">
          <div className="space-y-4">
            <Panel title="Seller and parties">
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <h3 className="font-medium">{invoice.seller.legalName}</h3>
                  <p className="text-sm">{addressText(invoice.seller)}</p>
                  <p className="text-sm text-muted-foreground">GSTIN {invoice.seller.gstin}</p>
                </div>
                <div>
                  <h3 className="font-medium">Bill-To · {invoice.billTo.name}</h3>
                  <p className="text-sm">{addressText(invoice.billTo)}</p>
                  <p className="text-sm text-muted-foreground">GSTIN {invoice.billTo.gstin}</p>
                </div>
                <div>
                  <h3 className="font-medium">Ship-To · {invoice.shipTo.label ?? 'Unavailable'}</h3>
                  <p className="text-sm">{addressText(invoice.shipTo)}</p>
                  <p className="text-sm text-muted-foreground">
                    Place of Supply uses Bill-To state.
                  </p>
                </div>
              </div>
            </Panel>
            <TaxInvoiceLines
              invoiceId={invoice.id}
              documentSnapshot={invoice.documentSnapshot}
              lines={invoice.lines}
              canOverride={mutable}
              pending={busy || refreshError}
              onOverride={setEditing}
            />
            <TaxInvoiceTotals invoice={invoice} />
            {invoice.status === 'FINALIZED' && invoice.roundingPolicy === null && (
              <p className="text-sm text-muted-foreground">
                Legacy invoice: payable round-off was not snapshotted. The original issued total is
                preserved.
              </p>
            )}
            {invoice.status === 'FINALIZED' && invoice.documentSnapshot === null && (
              <p className="text-sm text-muted-foreground">
                Legacy document: issued Style, size, image and order presentation was not
                snapshotted. Current master labels are shown for reference.
              </p>
            )}
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">Seller bank details</summary>
              <p className="mt-2">
                {invoice.seller.bankName} · {invoice.seller.bankAccountName} · Account{' '}
                {invoice.seller.bankAccountNumber} · IFSC {invoice.seller.bankIfsc}
              </p>
            </details>
          </div>
        </TabsContent>
        <TabsContent value="history">
          <Panel title="Financial history">
            {audit.isLoading ? (
              <LoadingState label="Loading financial history" />
            ) : audit.isError ? (
              <ErrorState
                title="Unable to load financial history"
                description={getApiErrorMessage(audit.error, 'Try again.')}
                action={
                  <Button variant="secondary" onClick={() => void audit.refetch()}>
                    Retry history
                  </Button>
                }
              />
            ) : (
              <AuditTrail
                items={(audit.data ?? []).map((event) => {
                  const metadata = event.metadata ?? {};
                  return {
                    id: event.id,
                    title: invoiceAuditTitle(event.action),
                    actor: event.actor?.name ?? 'System',
                    timestamp: formatInvoiceTimestamp(event.createdAt),
                    description: [
                      metadata.calculatedUnitRate
                        ? `Original rate ${formatInvoiceMoney(String(metadata.calculatedUnitRate))}`
                        : '',
                      metadata.overrideUnitRate
                        ? `Override ${formatInvoiceMoney(String(metadata.overrideUnitRate))}`
                        : '',
                      metadata.reason ? `Reason: ${String(metadata.reason)}` : '',
                      metadata.invoiceNumber ? `Invoice ${String(metadata.invoiceNumber)}` : '',
                    ]
                      .filter(Boolean)
                      .join(' · '),
                  };
                })}
                emptyState="No financial history available."
              />
            )}
          </Panel>
        </TabsContent>
      </Tabs>
      {editing && (
        <TaxInvoiceOverrideDialog
          key={editing.id}
          line={editing}
          pending={actions.override.isPending}
          onClose={() => setEditing(null)}
          onSave={actions.override.mutateAsync}
        />
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={(open) => {
          if (!busy) setConfirm(open);
        }}
        title="Finalize Tax Invoice?"
        description={`Reviewed payable: ${formatInvoiceMoney(invoice.payableTotal)}. Finalization allocates a permanent EI number and freezes the financial document. The backend revalidates all prerequisites.`}
        confirmLabel="Confirm finalization"
        loading={busy}
        onConfirm={() => void finalize()}
      />
    </div>
  );
}
