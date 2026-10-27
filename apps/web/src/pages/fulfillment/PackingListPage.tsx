import { useCallback, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { ConfirmDialog, createEnterToNextHandler, PageHeader, StatusBadge } from '@erve/app-components';
import { Button, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { StyleSizeGrid } from '../../components/style-size-grid/StyleSizeGrid.js';
import type { StyleSizeGridRow } from '../../components/style-size-grid/types.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import { CartonLabelButton } from './CartonLabelButton.js';
import { CartonQuantityPicker, selectedCartonLines, type CartonQuantities } from './CartonQuantityPicker.js';
import { distinctSizeColumns, groupLinesByStyle } from './style-size-grouping.js';
import { canMutateFactoryDispatches, canViewFactoryInvoices } from '../../auth/permissions.js';
import { useAuth } from '../../auth/AuthContext.js';
import type { FactoryPackingCartonView, FinalizeBlockers, PackingListDestinationView, PackingListView } from './types.js';

function auditStateBadge(state: PackingListDestinationView['cartons'][number]['auditState']) {
  if (state === 'INSPECTED') return <StatusBadge label="Inspected" tone="approved" />;
  if (state === 'NEEDS_REINSPECTION') return <StatusBadge label="Needs Reinspection" tone="rejected" />;
  return <StatusBadge label="Not Inspected" tone="draft" />;
}

// DEMO-018: per-field labels for the finalize-blocker summary line, in the
// same order the ticket's example uses ("CTN-001: Net Weight, Dimensions").
const PACKING_METADATA_FIELD_LABELS: Record<'netWeight' | 'grossWeight' | 'dimensions', string> = {
  netWeight: 'Net Weight',
  grossWeight: 'Gross Weight',
  dimensions: 'Dimensions',
};

// ISS-007/ISS-010: a carton's contents as one Style row per Style, with
// Sizes as columns, instead of one list item per Style+Size combination.
function cartonStyleSizeRows(
  carton: FactoryPackingCartonView,
  destinationLines: PackingListDestinationView['lines'],
): StyleSizeGridRow[] {
  // The destination projection already contains the authorized Style image. Carton
  // lines may omit it even when the same Style has a visible destination thumbnail.
  const primaryImageByStyle = new Map(
    destinationLines.filter((line) => line.primaryImage).map((line) => [line.styleId, line.primaryImage] as const),
  );
  for (const line of carton.lines) {
    if (!primaryImageByStyle.has(line.styleId) && line.primaryImage) {
      primaryImageByStyle.set(line.styleId, line.primaryImage);
    }
  }
  return groupLinesByStyle(carton.lines).map((group) => ({
    styleId: group.styleId,
    styleNumber: group.styleNumber,
    styleName: group.styleName,
    primaryImage: primaryImageByStyle.get(group.styleId) ?? null,
    values: Object.fromEntries(group.sizeEntries.map((entry) => [entry.sizeId, entry.quantity])),
  }));
}

// ISS-023 Phase 2: the destination's Required/Packed progress as two Style x
// Size matrices (one metric per matrix, per the operational-summary standard
// — a single matrix cannot carry two quantity metrics per cell) instead of
// one flat row per Style+Size combination.
function destinationStyleSizeRows(
  lines: PackingListDestinationView['lines'],
  metric: 'requiredQuantity' | 'packedQuantity',
): StyleSizeGridRow[] {
  const primaryImageByStyle = new Map(lines.map((line) => [line.styleId, line.primaryImage]));
  return groupLinesByStyle(lines.map((line) => ({ ...line, quantity: line[metric] }))).map((group) => ({
    styleId: group.styleId,
    styleNumber: group.styleNumber,
    styleName: group.styleName,
    primaryImage: primaryImageByStyle.get(group.styleId) ?? null,
    values: Object.fromEntries(group.sizeEntries.map((entry) => [entry.sizeId, entry.quantity])),
  }));
}

function finalizeIssueSummary(blockers: FinalizeBlockers): string[] {
  const lines: string[] = [];
  for (const c of blockers.cartonsNotAudited) lines.push(`Carton ${c.cartonNumber}: not yet inspected`);
  for (const c of blockers.cartonsNeedingReinspection) lines.push(`Carton ${c.cartonNumber}: needs reinspection (contents changed since last inspection)`);
  for (const c of blockers.emptyCartons) lines.push(`Carton ${c.cartonNumber}: is empty`);
  for (const c of blockers.destinationMismatchCartons) lines.push(`Carton ${c.cartonNumber}: contains a line for another destination — repacking required`);
  for (const l of blockers.underPackedLines) lines.push(`${l.styleNumber} / ${l.sizeLabel}: packed ${l.packed} of ${l.required} required`);
  for (const l of blockers.overPackedLines) lines.push(`${l.styleNumber} / ${l.sizeLabel}: packed ${l.packed} exceeds ${l.required} required`);
  for (const l of blockers.internalPackingMismatch) lines.push(`${l.styleNumber} / ${l.sizeLabel}: internal packing attribution mismatch — contact support`);
  for (const c of blockers.cartonsMissingPackingMetadata ?? []) {
    lines.push(`${c.cartonNumber}: ${c.missingFields.map((f) => PACKING_METADATA_FIELD_LABELS[f]).join(', ')}`);
  }
  return lines;
}

/**
 * ISS-098: Visible, conservative preflight blockers for a Draft Factory Packing
 * List. The backend's transaction remains the authority for finalization and
 * checks fresh data, including reconciliation that cannot be verified here.
 */
function packingFinalizeReadiness(packingList: PackingListView): string[] {
  const cartons = packingList.destinations.flatMap((destination) =>
    destination.cartons.filter((carton) => !carton.retired),
  );
  const lines = packingList.destinations.flatMap((destination) => destination.lines);
  const notInspected = cartons.filter((carton) => carton.auditState === 'NOT_INSPECTED').length;
  const reinspection = cartons.filter((carton) => carton.auditState === 'NEEDS_REINSPECTION').length;
  const missingMetadata = cartons.filter((carton) =>
    carton.netWeight == null || carton.grossWeight == null || !carton.dimensions?.trim(),
  ).length;
  const emptyCartons = cartons.filter((carton) => carton.lines.length === 0).length;
  const mismatchedCartons = cartons.filter((carton) => carton.destinationMismatch).length;
  const underPacked = lines.filter((line) => line.packedQuantity < line.requiredQuantity).length;
  const overPacked = lines.filter((line) => line.packedQuantity > line.requiredQuantity).length;
  const issues: string[] = [];

  if (notInspected + reinspection > 0) {
    const count = notInspected + reinspection;
    issues.push(`Waiting for Packing Audit: ${count} carton${count === 1 ? '' : 's'} (${notInspected} not inspected, ${reinspection} needing reinspection). Ask QA to complete the audit.`);
  }
  if (underPacked > 0) issues.push(`Packing incomplete: ${underPacked} Size ${underPacked === 1 ? 'quantity is' : 'quantities are'} below the required quantity.`);
  if (overPacked > 0) issues.push(`Packing exceeds the required quantity for ${overPacked} Size ${overPacked === 1 ? 'entry' : 'entries'}.`);
  if (missingMetadata > 0) issues.push(`Complete Net Weight, Gross Weight and Dimensions for ${missingMetadata} carton${missingMetadata === 1 ? '' : 's'}.`);
  if (emptyCartons > 0) issues.push(`${emptyCartons} carton${emptyCartons === 1 ? ' is' : 's are'} empty; add contents or remove the carton.`);
  if (mismatchedCartons > 0) issues.push(`${mismatchedCartons} carton${mismatchedCartons === 1 ? ' has' : 's have'} a destination mismatch.`);
  if (cartons.length === 0 && lines.some((line) => line.requiredQuantity > 0)) {
    issues.push('No cartons recorded. Add cartons before finalizing.');
  }
  return issues;
}

interface ShellProps {
  fetchUrl: string;
  queryKey: unknown[];
  backLabel: string;
  backTo: string;
}

function PackingListShell({ fetchUrl, queryKey, backLabel, backTo }: ShellProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canMutate = canMutateFactoryDispatches(user);

  const [cartonNumber, setCartonNumber] = useState('');
  const [cartonNumberError, setCartonNumberError] = useState('');
  const cartonNumberInputRef = useRef<HTMLInputElement>(null);
  const [packageDetails, setPackageDetails] = useState('');
  const [netWeight, setNetWeight] = useState('');
  const [grossWeight, setGrossWeight] = useState('');
  const [dimensions, setDimensions] = useState('');
  // Blur commits precede Save clicks. Refs keep submission guards current in that
  // event sequence; state renders committed quantities and invalid-draft buttons.
  const [cartonLineQty, setCartonLineQty] = useState<CartonQuantities>({});
  const cartonQtyRef = useRef<CartonQuantities>({});
  const addInvalidRef = useRef(new Set<string>());
  const [addInvalid, setAddInvalid] = useState(new Set<string>());
  const savingCartonRef = useRef(false);
  const [addingForDestination, setAddingForDestination] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [abandonOpen, setAbandonOpen] = useState(false);
  const [finalizeIssues, setFinalizeIssues] = useState<string[] | null>(null);

  // Carton edit form state — desired-state PATCH, hydrated from the carton
  // being edited. editOriginalLineQty is a one-time snapshot of the
  // carton's OWN contents at the moment Edit was opened, used only to
  // compute each line's true remaining capacity while editing (a line's
  // "remaining" must add back this carton's own current contribution,
  // since editing replaces it rather than stacking on top).
  const [editingCartonId, setEditingCartonId] = useState<string | null>(null);
  const [editDestinationId, setEditDestinationId] = useState('');
  const [editPackageDetails, setEditPackageDetails] = useState('');
  const [editNetWeight, setEditNetWeight] = useState('');
  const [editGrossWeight, setEditGrossWeight] = useState('');
  const [editDimensions, setEditDimensions] = useState('');
  const [editLineQty, setEditLineQty] = useState<CartonQuantities>({});
  const editQtyRef = useRef<CartonQuantities>({});
  const editInvalidRef = useRef(new Set<string>());
  const [editInvalid, setEditInvalid] = useState(new Set<string>());
  const [editOriginalLineQty, setEditOriginalLineQty] = useState<Record<string, number>>({});

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PackingListView>>(fetchUrl);
      return res.data.data;
    },
  });
  const packingList = query.data;

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey });
  }

  function resetAdd() {
    setCartonNumberError('');
    cartonQtyRef.current = {};
    setCartonLineQty({});
    addInvalidRef.current.clear();
    setAddInvalid(new Set());
    setAddingForDestination(null);
  }

  function changeQuantity(id: string, quantity: number | null, edit = false) {
    const ref = edit ? editQtyRef : cartonQtyRef;
    ref.current = { ...ref.current, [id]: quantity };
    (edit ? setEditLineQty : setCartonLineQty)(ref.current);
  }

  function changeValidity(id: string, valid: boolean, edit = false) {
    const ref = edit ? editInvalidRef : addInvalidRef;
    if (valid) ref.current.delete(id);
    else ref.current.add(id);
    (edit ? setEditInvalid : setAddInvalid)(new Set(ref.current));
  }

  function canSaveCarton(destinationId: string, edit = false) {
    const lines = packingList?.destinations.find((d) => d.id === destinationId)?.lines ?? [];
    return canMutate && (!packingList?.factoryDispatch || packingList.factoryDispatch.status === 'DRAFT') &&
      !(edit ? editInvalidRef : addInvalidRef).current.size &&
      selectedCartonLines(lines, (edit ? editQtyRef : cartonQtyRef).current, edit ? editOriginalLineQty : {}) !== null;
  }

  function submitCarton(destinationId: string, edit = false) {
    if (savingCartonRef.current || !canSaveCarton(destinationId, edit) || (!edit && !cartonNumber.trim())) return;
    if (!edit && !packingList?.destinations.find((destination) => destination.id === destinationId)?.lines.some(
      (line) => line.packedQuantity < line.requiredQuantity,
    )) return;
    savingCartonRef.current = true;
    if (edit) editCartonMutation.mutate();
    else addCartonMutation.mutate(destinationId);
  }

  const addCartonMutation = useMutation({
    mutationFn: async (destinationId: string) => {
      const lines = selectedCartonLines(packingList?.destinations.find((d) => d.id === destinationId)?.lines ?? [], cartonQtyRef.current);
      if (!canSaveCarton(destinationId) || !lines) throw new Error('Invalid carton quantities.');
      const res = await apiClient.post<ApiSuccessResponse<PackingListView>>(
        `/sale-orders/${packingList!.saleOrderId}/packing-list/cartons`,
        {
          cartonNumber,
          destinationId,
          packageDetails: packageDetails || null,
          netWeight: netWeight ? Number(netWeight) : null,
          grossWeight: grossWeight ? Number(grossWeight) : null,
          dimensions: dimensions || null,
          lines,
        },
      );
      return res.data.data;
    },
    onSuccess: () => {
      setCartonNumber('');
      setPackageDetails('');
      setNetWeight('');
      setGrossWeight('');
      setDimensions('');
      resetAdd();
      return invalidate();
    },
    onError: (caught) => {
      const message = getApiErrorMessage(caught, 'Unable to add the carton.');
      if (/carton number.+already exists/i.test(message)) {
        setCartonNumberError(message);
        setFormError('');
        cartonNumberInputRef.current?.focus();
      } else {
        setFormError(message);
      }
    },
    onSettled: () => { savingCartonRef.current = false; },
  });

  const removeCartonMutation = useMutation({
    mutationFn: async ({ cartonId, expectedVersion }: { cartonId: string; expectedVersion: number }) => {
      await apiClient.delete(`/factory-dispatches/${packingList!.factoryDispatch!.id}/cartons/${cartonId}`, {
        data: { expectedVersion },
      });
    },
    onSuccess: invalidate,
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to remove/retire the carton.')),
  });

  function closeEdit() {
    setEditingCartonId(null);
    setEditDestinationId('');
    setEditPackageDetails('');
    setEditNetWeight('');
    setEditGrossWeight('');
    setEditDimensions('');
    setEditLineQty({});
    editQtyRef.current = {};
    editInvalidRef.current.clear();
    setEditInvalid(new Set());
    setEditOriginalLineQty({});
  }

  function openEdit(carton: FactoryPackingCartonView) {
    resetAdd();
    editInvalidRef.current.clear();
    setEditInvalid(new Set());
    setEditingCartonId(carton.id);
    setEditDestinationId(carton.destinationId);
    setEditPackageDetails(carton.packageDetails ?? '');
    setEditNetWeight(carton.netWeight ?? '');
    setEditGrossWeight(carton.grossWeight ?? '');
    setEditDimensions(carton.dimensions ?? '');
    editQtyRef.current = Object.fromEntries(carton.lines.map((l) => [l.saleOrderLineId, l.quantity]));
    setEditLineQty(editQtyRef.current);
    setEditOriginalLineQty(Object.fromEntries(carton.lines.map((l) => [l.saleOrderLineId, l.quantity])));
  }

  function changeEditDestination(destinationId: string) {
    setEditDestinationId(destinationId);
    // A different destination's lines are an entirely different set of
    // valid saleOrderLineIds — any quantities entered for the previous
    // destination's lines are no longer valid choices and must not be
    // silently resubmitted.
    setEditLineQty({});
    editQtyRef.current = {};
    editInvalidRef.current.clear();
    setEditInvalid(new Set());
  }

  const editingCarton = editingCartonId
    ? (packingList?.destinations.flatMap((d) => d.cartons).find((c) => c.id === editingCartonId) ?? null)
    : null;

  const editCartonMutation = useMutation({
    mutationFn: async () => {
      const carton = editingCarton!;
      const lines = selectedCartonLines(packingList?.destinations.find((d) => d.id === editDestinationId)?.lines ?? [], editQtyRef.current, editOriginalLineQty);
      if (!carton || !canSaveCarton(editDestinationId, true) || !lines) throw new Error('Invalid carton quantities.');
      const res = await apiClient.patch<ApiSuccessResponse<PackingListView>>(
        `/factory-dispatches/${packingList!.factoryDispatch!.id}/cartons/${carton.id}`,
        {
          expectedVersion: carton.version,
          destinationId: editDestinationId,
          packageDetails: editPackageDetails || null,
          netWeight: editNetWeight ? Number(editNetWeight) : null,
          grossWeight: editGrossWeight ? Number(editGrossWeight) : null,
          dimensions: editDimensions || null,
          lines,
        },
      );
      return res.data.data;
    },
    onSuccess: () => {
      closeEdit();
      return invalidate();
    },
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to update the carton.')),
    onSettled: () => { savingCartonRef.current = false; },
  });

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiSuccessResponse<PackingListView>>(
        `/factory-dispatches/${packingList!.factoryDispatch!.id}/actions/finalize`,
        { expectedVersion: packingList!.factoryDispatch!.version },
      );
      return res.data.data;
    },
    onSuccess: () => {
      setFinalizeIssues(null);
      return invalidate();
    },
    onError: (caught) => {
      const details = (caught as { response?: { data?: { error?: { details?: FinalizeBlockers } } } })?.response?.data
        ?.error?.details;
      if (details) setFinalizeIssues(finalizeIssueSummary(details));
      setFormError(getApiErrorMessage(caught, 'Unable to finalize this Factory Dispatch.'));
    },
  });

  const abandonMutation = useMutation({
    mutationFn: async () => {
      await apiClient.delete(`/factory-dispatches/${packingList!.factoryDispatch!.id}`, {
        data: { expectedVersion: packingList!.factoryDispatch!.version },
      });
    },
    onSuccess: () => navigate(backTo),
    onError: (caught) => {
      setAbandonOpen(false);
      setFormError(getApiErrorMessage(caught, 'Unable to abandon this Factory Dispatch.'));
    },
  });

  const generateFactoryPackingListPdf = useCallback(async () => {
    if (!packingList) throw new Error('Packing list not loaded');
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generateFactoryPackingListPdfBlob } = await import('./pdf/factory-packing-list/generateFactoryPackingListPdf.js');
    return generateFactoryPackingListPdfBlob(packingList, { generatedAt: new Date().toISOString(), generatedBy: user?.name });
  }, [packingList, user?.name]);

  const pdfAction = usePdfAction({
    generate: generateFactoryPackingListPdf,
    filename: () => buildPdfFilename(['ERVE-Factory-Packing-List', packingList?.saleOrderNumber, packingList?.factoryDispatch?.factoryDispatchNumber]),
  });

  if (query.isLoading) return <LoadingState label="Loading Packing List" />;
  if (query.isError)
    return <ErrorState title="Unable to load Packing List" description={query.error.message} />;
  if (!packingList) return <EmptyState title="Dispatch Order not found" tone="error" />;

  const dispatch = packingList.factoryDispatch;
  const isDraft = !dispatch || dispatch.status === 'DRAFT';
  const canFinalize = Boolean(dispatch) && isDraft;
  const finalizeBlockers = packingFinalizeReadiness(packingList);
  const finalizeDisabled = finalizeBlockers.length > 0 || query.isFetching || finalizeMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title={packingList.saleOrderNumber}
        subtitle={`${packingList.factory.name} · ${packingList.distributors.map((d) => d.name).join(', ')}${dispatch ? ` · ${dispatch.factoryDispatchNumber}` : ''}`}
        status={
          dispatch ? (
            <StatusBadge
              label={dispatch.status === 'READY_FOR_ERVE' ? 'Ready for Erve' : 'Draft'}
              tone={dispatch.status === 'READY_FOR_ERVE' ? 'approved' : 'draft'}
            />
          ) : (
            <StatusBadge label="Not started" tone="draft" />
          )
        }
        secondaryActions={
          <>
            {/* UXAUTH-012: an invoice existing is not enough — the target
                route (/fulfillment/factory-invoices/:id) is guarded by the
                narrower FACTORY_INVOICE_VIEW_ROLES, which excludes
                MERCHANDISER/SENIOR_MANAGEMENT even though they can read this
                Packing List (FACTORY_DISPATCH_VIEW_ROLES). */}
            {dispatch?.factoryInvoiceId && canViewFactoryInvoices(user) && (
              <Button variant="secondary" onClick={() => navigate(`/fulfillment/factory-invoices/${dispatch.factoryInvoiceId}`)}>
                View Factory Invoice
              </Button>
            )}
            <PdfActionButtons
              isGenerating={pdfAction.isGenerating}
              error={pdfAction.error}
              onDownload={pdfAction.handleDownload}
              onPrint={pdfAction.handlePrint}
            />
            <Button variant="secondary" onClick={() => navigate(backTo)}>
              {backLabel}
            </Button>
          </>
        }
        primaryAction={
          canMutate && canFinalize && dispatch ? (
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button variant="destructive" onClick={() => setAbandonOpen(true)}>
                Abandon
              </Button>
              <div className="flex flex-col items-end gap-1">
                <Button
                  onClick={() => finalizeMutation.mutate()}
                  disabled={finalizeDisabled}
                  loading={finalizeMutation.isPending}
                >
                  Finalize (Ready for Erve)
                </Button>
                {query.isFetching ? (
                  <span role="status" className="text-xs text-muted-foreground">Refreshing packing status…</span>
                ) : finalizeBlockers.length > 0 ? (
                  <div role="status" className="max-w-sm space-y-1 text-right text-xs text-muted-foreground">
                    {finalizeBlockers.map((reason) => <div key={reason}>{reason}</div>)}
                  </div>
                ) : null}
              </div>
            </div>
          ) : undefined
        }
      />

      {formError && <ValidationMessage tone="error">{formError}</ValidationMessage>}
      {finalizeIssues && finalizeIssues.length > 0 && (
        <ValidationMessage tone="warning">
          <div className="space-y-1">
            <div>Cannot finalize yet:</div>
            <ul className="list-disc pl-5">
              {finalizeIssues.map((line, idx) => (
                <li key={idx}>{line}</li>
              ))}
            </ul>
          </div>
        </ValidationMessage>
      )}

      <div className="space-y-6">
        {packingList.destinations.map((destination) => (
          <Panel
            key={destination.id}
            title={`${destination.label ?? `${destination.city}, ${destination.state}`} — ${destination.distributor.name}`}
          >
            <div className="space-y-4">
              <DescriptionList columns={3}>
                <DescriptionList.Item
                  label="Address"
                  value={`${destination.addressLine1}${destination.addressLine2 ? `, ${destination.addressLine2}` : ''}, ${destination.city}, ${destination.state}, ${destination.country}`}
                />
                {destination.contactName && <DescriptionList.Item label="Contact" value={destination.contactName} />}
              </DescriptionList>

              <div className="space-y-3">
                <div>
                  <div className="mb-1 text-xs font-semibold text-muted-foreground">Required</div>
                  <StyleSizeGrid
                    columns={distinctSizeColumns(destination.lines)}
                    rows={destinationStyleSizeRows(destination.lines, 'requiredQuantity')}
                    variant="readOnly"
                  />
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold text-muted-foreground">Packed</div>
                  <StyleSizeGrid
                    columns={distinctSizeColumns(destination.lines)}
                    rows={destinationStyleSizeRows(destination.lines, 'packedQuantity')}
                    variant="readOnly"
                  />
                </div>
              </div>

              <div className="space-y-3">
                {destination.cartons.map((carton) =>
                  editingCartonId === carton.id ? (
                    <div key={carton.id} className="rounded-md border border-primary p-3">
                      <div className="mb-3 font-medium">Editing Carton {carton.cartonNumber}</div>
                      {carton.auditState === 'INSPECTED' && (
                        <ValidationMessage tone="warning">
                          This carton is currently Inspected. Saving a change to its destination, contents, package
                          details, weight, or dimensions will mark it Needs Reinspection.
                        </ValidationMessage>
                      )}
                      <div className="mt-3 space-y-3">
                        <p className="text-xs text-muted-foreground">Net Weight, Gross Weight, and Dimensions can be entered later, but are required before finalizing the Factory Packing List.</p>
                        <div className="flex flex-wrap gap-3">
                          <SelectField label="Destination" value={editDestinationId} onValueChange={changeEditDestination} width="fill">
                            {packingList.destinations.map((d) => (
                              <SelectItem key={d.id} value={d.id}>
                                {d.label ?? `${d.city}, ${d.state}`} — {d.distributor.name}
                              </SelectItem>
                            ))}
                          </SelectField>
                          <TextField
                            label="Package Details (optional)"
                            value={editPackageDetails}
                            onChange={(e) => setEditPackageDetails(e.target.value)}
                          />
                          <TextField
                            label="Net Weight, kg"
                            type="number"
                            min={0}
                            value={editNetWeight}
                            onChange={(e) => setEditNetWeight(e.target.value)}
                          />
                          <TextField
                            label="Gross Weight, kg"
                            type="number"
                            min={0}
                            value={editGrossWeight}
                            onChange={(e) => setEditGrossWeight(e.target.value)}
                          />
                          <TextField
                            label="Dimensions"
                            value={editDimensions}
                            onChange={(e) => setEditDimensions(e.target.value)}
                          />
                        </div>
                        <CartonQuantityPicker
                          key={`${carton.id}:${editDestinationId}`}
                          lines={packingList.destinations.find((d) => d.id === editDestinationId)?.lines ?? []}
                          quantities={editLineQty}
                          originalQuantities={editOriginalLineQty}
                          onChange={(id, quantity) => changeQuantity(id, quantity, true)}
                          onValidationChange={(id, valid) => changeValidity(id, valid, true)}
                        />
                        <div className="flex gap-2">
                          <Button
                            onClick={() => submitCarton(editDestinationId, true)}
                            disabled={!isDraft || !canMutate || editInvalid.size > 0 || !selectedCartonLines(packingList.destinations.find((d) => d.id === editDestinationId)?.lines ?? [], editLineQty, editOriginalLineQty) || addCartonMutation.isPending || editCartonMutation.isPending}
                            loading={editCartonMutation.isPending}
                          >
                            Save Changes
                          </Button>
                          <Button variant="secondary" onClick={closeEdit} disabled={editCartonMutation.isPending}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div key={carton.id} className="rounded-md border border-border p-3">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">
                          Carton {carton.cartonNumber}
                          {carton.netWeight && <span className="ml-2 text-sm text-muted-foreground">Net {carton.netWeight} kg</span>}
                          {carton.grossWeight && <span className="ml-2 text-sm text-muted-foreground">Gross {carton.grossWeight} kg</span>}
                          {carton.dimensions && <span className="ml-2 text-sm text-muted-foreground">{carton.dimensions}</span>}
                          <span className="ml-2">{auditStateBadge(carton.auditState)}</span>
                          {carton.destinationMismatch && (
                            <span className="ml-2">
                              <StatusBadge label="Destination mismatch — repack required" tone="rejected" />
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <CartonLabelButton
                            carton={carton}
                            destination={destination}
                            saleOrderNumber={packingList.saleOrderNumber}
                            factoryName={packingList.factory.name}
                            factoryDispatchNumber={dispatch?.factoryDispatchNumber ?? null}
                            generatedByName={user?.name}
                          />
                          {isDraft && canMutate && (
                            <div className="flex gap-2">
                              <Button variant="ghost" density="compact" onClick={() => openEdit(carton)} disabled={addCartonMutation.isPending || editCartonMutation.isPending}>
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                density="compact"
                                onClick={() => removeCartonMutation.mutate({ cartonId: carton.id, expectedVersion: carton.version })}
                                loading={removeCartonMutation.isPending}
                              >
                                {carton.auditHistory.length > 0 ? 'Retire' : 'Delete'}
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                      {carton.packageDetails && <div className="text-sm text-muted-foreground">{carton.packageDetails}</div>}
                      <div className="mt-2">
                        <StyleSizeGrid
                          columns={distinctSizeColumns(carton.lines)}
                          rows={cartonStyleSizeRows(carton, destination.lines)}
                          variant="readOnly"
                        />
                      </div>
                    </div>
                  ),
                )}
                {destination.cartons.length === 0 && <div className="text-sm text-muted-foreground">No cartons yet.</div>}
              </div>

              {isDraft && canMutate && (
                <div className="rounded-md border border-dashed border-border p-3">
                  {!destination.lines.some((line) => line.packedQuantity < line.requiredQuantity) ? (
                    <p className="text-sm text-muted-foreground">
                      {destination.lines.length === 0
                        ? 'No quantities are assigned to this destination.'
                        : 'All required quantities for this destination are packed. Edit or delete/retire an existing carton to make corrections.'}
                    </p>
                  ) : addingForDestination === destination.id ? (
                    <div className="space-y-3" onKeyDown={createEnterToNextHandler()}>
                      <p className="text-xs text-muted-foreground">Net Weight, Gross Weight, and Dimensions can be entered later, but are required before finalizing the Factory Packing List.</p>
                      <div className="flex flex-wrap gap-3">
                        <TextField
                          ref={cartonNumberInputRef}
                          label="Carton Number"
                          value={cartonNumber}
                          errorMessage={cartonNumberError || undefined}
                          onChange={(e) => {
                            setCartonNumber(e.target.value);
                            if (cartonNumberError) setCartonNumberError('');
                          }}
                        />
                        <TextField label="Package Details (optional)" value={packageDetails} onChange={(e) => setPackageDetails(e.target.value)} />
                        <TextField label="Net Weight, kg" type="number" min={0} value={netWeight} onChange={(e) => setNetWeight(e.target.value)} />
                        <TextField label="Gross Weight, kg" type="number" min={0} value={grossWeight} onChange={(e) => setGrossWeight(e.target.value)} />
                        <TextField label="Dimensions" value={dimensions} onChange={(e) => setDimensions(e.target.value)} />
                      </div>
                      <CartonQuantityPicker
                        key={destination.id}
                        lines={destination.lines}
                        quantities={cartonLineQty}
                        onChange={changeQuantity}
                        onValidationChange={changeValidity}
                      />
                      {addInvalid.size > 0 && (
                        <ValidationMessage tone="error">
                          Correct the highlighted Size quantities above before adding this carton.
                        </ValidationMessage>
                      )}
                      <div className="flex gap-2">
                        <Button
                          onClick={() => submitCarton(destination.id)}
                          disabled={!cartonNumber.trim() || addInvalid.size > 0 || !selectedCartonLines(destination.lines, cartonLineQty) || addCartonMutation.isPending || editCartonMutation.isPending}
                          loading={addCartonMutation.isPending}
                        >
                          Add Carton
                        </Button>
                        <Button variant="secondary" onClick={resetAdd} disabled={addCartonMutation.isPending}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button variant="secondary" onClick={() => { closeEdit(); resetAdd(); setAddingForDestination(destination.id); }} disabled={addCartonMutation.isPending || editCartonMutation.isPending}>
                      Add Carton
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Panel>
        ))}

        {packingList.retiredCartons.length > 0 && (
          <Panel title="Retired Cartons (historical)">
            <ul className="space-y-1 text-sm text-muted-foreground">
              {packingList.retiredCartons.map((carton) => (
                <li key={carton.id}>
                  Carton {carton.cartonNumber} — retired {carton.retiredAt ? new Date(carton.retiredAt).toLocaleString() : ''}
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>

      <ConfirmDialog
        open={abandonOpen}
        onOpenChange={setAbandonOpen}
        title="Abandon this Factory Dispatch?"
        description="This DRAFT packing batch and its cartons will be permanently deleted. This cannot be undone."
        confirmLabel="Abandon"
        destructive
        loading={abandonMutation.isPending}
        onConfirm={() => abandonMutation.mutate()}
      />
    </div>
  );
}

export function PackingListPage() {
  const { id: saleOrderId } = useParams();
  return (
    <PackingListShell
      queryKey={['packing-list', saleOrderId]}
      fetchUrl={`/sale-orders/${saleOrderId}/packing-list`}
      backLabel="Back to Dispatch Order"
      backTo={`/sale-orders/${saleOrderId}`}
    />
  );
}

export function FactoryDispatchDetailPage() {
  const { id } = useParams();
  return (
    <PackingListShell
      queryKey={['packing-list', 'factory-dispatch', id]}
      fetchUrl={`/factory-dispatches/${id}`}
      backLabel="Back"
      backTo="/fulfillment/factory-dispatches"
    />
  );
}
