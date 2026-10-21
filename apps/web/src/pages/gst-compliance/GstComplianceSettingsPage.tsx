import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { canManageGstComplianceSettings, canViewGstComplianceSettings } from '@erve/shared';
import type { ApiSuccessResponse, GstComplianceSettings, GstComplianceSettingsAudit, GstComplianceValues, UpdateGstComplianceSettings } from '@erve/types';
import { ConfirmDialog, PageHeader, StatusBadge, createEnterToNextHandler } from '@erve/app-components';
import { Button, Radio, RadioGroup, Switch, ValidationMessage } from '@erve/primitives';
import { FormGrid, FormSection, Panel } from '@erve/layout';
import { ErrorState, LoadingState } from '@erve/data-display';
import { useAuth } from '../../auth/AuthContext.js';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { AccountantGstinLookup } from './GstinVerificationPanel.js';

const SETTINGS_KEY = ['gst-compliance-settings'] as const;
const AUDIT_KEY = ['gst-compliance-settings-audit'] as const;
const PATH = '/gst-compliance/settings';

export function GstComplianceSettingsPage() {
  const { user } = useAuth();
  const allowed = !!user && canViewGstComplianceSettings(user);
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [reloadRevision, setReloadRevision] = useState(0);
  const query = useQuery({
    queryKey: SETTINGS_KEY, enabled: allowed, refetchOnWindowFocus: false,
    queryFn: async () => (await apiClient.get<ApiSuccessResponse<GstComplianceSettings>>(PATH)).data.data,
  });
  const audit = useQuery({
    queryKey: AUDIT_KEY, enabled: allowed,
    queryFn: async () => (await apiClient.get<ApiSuccessResponse<GstComplianceSettingsAudit[]>>(`${PATH}/audit`)).data.data,
  });
  if (!allowed) return <ErrorState title="You do not have permission to view GST Compliance Settings" />;
  if (query.isPending) return <LoadingState label="Loading GST Compliance Settings" />;
  if (query.isError) return <ErrorState title="Unable to load GST Compliance Settings" description={getApiErrorMessage(query.error, 'Unable to load settings. Try again.')} action={<Button onClick={() => void query.refetch()}>Retry</Button>} />;

  return (
    <div className="space-y-4">
      <PageHeader title="GST Compliance Settings" status={<StatusBadge label={query.data.integrationMode === 'DEMO' ? 'Demo Mode' : 'Live Mode'} tone={query.data.integrationMode === 'DEMO' ? 'draft' : 'approved'} />} />
      {saved && <div role="status"><ValidationMessage tone="success">Settings saved.</ValidationMessage></div>}
      <SettingsEditor
        key={`${query.data.version}:${reloadRevision}`}
        settings={query.data}
        canEdit={!!user && canManageGstComplianceSettings(user)}
        onEditing={() => setSaved(false)}
        onSaved={(settings) => {
          queryClient.setQueryData(SETTINGS_KEY, settings);
          void queryClient.invalidateQueries({ queryKey: AUDIT_KEY });
          void queryClient.invalidateQueries({ queryKey: ['gst-verification-policy'] });
          void queryClient.invalidateQueries({ queryKey: ['gst-verification'] });
          setSaved(true);
        }}
        onReload={async () => {
          setSaved(false);
          const result = await query.refetch();
          if (result.isSuccess) setReloadRevision((value) => value + 1);
        }}
      />
      {user?.roles.includes('ACCOUNTANT') && query.data.onlineGstinVerificationEnabled && <AccountantGstinLookup />}
      <Panel title="Recent settings history">
        {audit.isPending ? <LoadingState label="Loading settings history" /> : audit.isError ? (
          <ValidationMessage tone="error">Settings history is unavailable. <Button variant="secondary" onClick={() => void audit.refetch()}>Retry history</Button></ValidationMessage>
        ) : audit.data.length === 0 ? <p className="text-sm text-muted-foreground">No settings changes recorded.</p> : (
          <ul className="space-y-3 text-sm">
            {audit.data.map((event) => <li key={event.id}>
              <p>{event.actor?.name ?? 'Former user'} · {new Date(event.createdAt).toLocaleString()} · Revision {event.next.version}</p>
              <p className="text-muted-foreground">{describeChanges(event)}</p>
            </li>)}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Showing up to 100 most recent changes.</p>
      </Panel>
    </div>
  );
}

function describeChanges(event: GstComplianceSettingsAudit): string {
  const labels: Record<keyof GstComplianceValues, string> = {
    integrationMode: 'Mode', onlineGstinVerificationEnabled: 'Online GSTIN verification',
    gstinVerificationLevel: 'Verification detail', ewayBillGenerationEnabled: 'E-Way Bill generation',
  };
  const display = (value: string | boolean) => typeof value === 'boolean' ? value ? 'On' : 'Off' : ({ DEMO: 'Demo Mode', LIVE: 'Live Mode', BASIC: 'Basic Verification', COMPLETE: 'Complete Profile' }[value] ?? value);
  return (Object.keys(labels) as (keyof GstComplianceValues)[])
    .filter((key) => event.previous[key] !== event.next[key])
    .map((key) => `${labels[key]}: ${display(event.previous[key])} → ${display(event.next[key])}`).join('; ');
}

function SettingsEditor({ settings, canEdit, onSaved, onReload, onEditing }: {
  settings: GstComplianceSettings; canEdit: boolean;
  onSaved: (settings: GstComplianceSettings) => void; onReload: () => Promise<void>;
  onEditing: () => void;
}) {
  const [form, setForm] = useState<GstComplianceValues>({
    integrationMode: settings.integrationMode, onlineGstinVerificationEnabled: settings.onlineGstinVerificationEnabled,
    gstinVerificationLevel: settings.gstinVerificationLevel, ewayBillGenerationEnabled: settings.ewayBillGenerationEnabled,
  });
  const [confirmLive, setConfirmLive] = useState(false);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  function updateForm(values: Partial<GstComplianceValues>) {
    setForm((current) => ({ ...current, ...values }));
    onEditing();
  }
  const [error, setError] = useState('');
  const [reloading, setReloading] = useState(false);
  const submitting = useRef(false);
  const mutation = useMutation({
    mutationFn: async (confirmed: boolean) => {
      const payload: UpdateGstComplianceSettings = { ...form, expectedVersion: settings.version, ...(confirmed ? { confirmLiveActivation: true } : {}) };
      return (await apiClient.patch<ApiSuccessResponse<GstComplianceSettings>>(PATH, payload)).data.data;
    },
    onSuccess: onSaved,
    onError: (caught) => setError(getApiErrorMessage(caught, 'Unable to save GST Compliance Settings')),
  });
  const busy = mutation.isPending || reloading;
  const disabled = !canEdit || busy;
  const changed = form.integrationMode !== settings.integrationMode || form.onlineGstinVerificationEnabled !== settings.onlineGstinVerificationEnabled || form.gstinVerificationLevel !== settings.gstinVerificationLevel;
  async function save(confirmed = false) {
    if (submitting.current || disabled || !changed) return;
    if (form.integrationMode === 'LIVE' && settings.integrationMode !== 'LIVE' && !confirmed) { setConfirmLive(true); return; }
    submitting.current = true;
    onEditing();
    setError('');
    try { await mutation.mutateAsync(confirmed); }
    catch { /* The mutation displays a safe error and preserves the draft. */ }
    finally { submitting.current = false; setConfirmLive(false); }
  }
  return (
    <Panel>
      {!canEdit && <p className="mb-4 text-sm text-muted-foreground">Only an Accountant can change these settings.</p>}
      <form className="space-y-5" onKeyDown={createEnterToNextHandler()} onSubmit={(event) => { event.preventDefault(); void save(); }}>
        {error && <div role="alert"><ValidationMessage tone="error">{error}</ValidationMessage></div>}
        <FormGrid columns={2} gap="sm">
          <FormSection title="Integration Mode">
            <RadioGroup aria-label="Integration Mode" value={form.integrationMode} onValueChange={(value) => updateForm({ integrationMode: value as GstComplianceValues['integrationMode'] })} disabled={disabled}>
              <Radio id="gst-demo-mode" value="DEMO" label="Demo Mode" description="Use free test requests. No real government verification or statutory generation." />
              <Radio id="gst-live-mode" value="LIVE" label="Live Mode" disabled={disabled || !settings.capabilities.liveActivationAvailable} description="Use actual GST verification and statutory operations, subject to production authorization." />
            </RadioGroup>
            {!settings.capabilities.liveActivationAvailable && <p className="mt-2 text-sm text-muted-foreground">Live Mode is unavailable until server-side production authorization is enabled.</p>}
          </FormSection>
          <FormSection title="Online GSTIN Verification">
            <Switch id="gst-verification-enabled" label="Enable Online GSTIN Verification" checked={form.onlineGstinVerificationEnabled} disabled={disabled} onCheckedChange={(checked) => updateForm({ onlineGstinVerificationEnabled: checked })} description="Verify GST registration details through the configured compliance service." />
            <p className="mt-2 text-sm text-muted-foreground">Local GSTIN format validation and existing required fields continue. Use an explicit verification action to check a saved GSTIN. Saving these preferences performs no lookup.</p>
          </FormSection>
          <FormSection title="Verification Detail Level">
            <RadioGroup aria-label="Verification Detail Level" value={form.gstinVerificationLevel} disabled={disabled || !form.onlineGstinVerificationEnabled} onValueChange={(value) => updateForm({ gstinVerificationLevel: value as GstComplianceValues['gstinVerificationLevel'] })}>
              <Radio id="gst-basic-level" value="BASIC" label="Basic Verification — 1 credit" description="Registration status and basic taxpayer details." />
              <Radio id="gst-complete-level" value="COMPLETE" label="Complete Profile — 2 credits" description="Registration details, filing frequency and latest filed return periods." />
            </RadioGroup>
            <p className="mt-2 text-sm">Estimated live lookup: {form.gstinVerificationLevel === 'BASIC' ? '1 credit' : '2 credits'} per successful uncached request.</p>
            <p className="text-sm text-muted-foreground">Estimates are not actual charges. Supported Demo Mode test requests use 0 credits. Changes apply to future checks.</p>
          </FormSection>
          <FormSection title="E-Way Bill Generation">
            <Switch id="gst-eway-enabled" label="Enable E-Way Bill Generation" checked={false} disabled description="Allow system-generated e-way bills for eligible dispatches after user confirmation." />
            <p className="mt-2 text-sm text-muted-foreground">E-Way Bill generation is not yet available.</p>
          </FormSection>
        </FormGrid>
        <p className="text-sm text-muted-foreground">{settings.updatedAt ? `Last updated by ${settings.updatedBy?.name ?? 'Former user'} on ${new Date(settings.updatedAt).toLocaleString()}` : 'Default settings. No changes saved yet.'}</p>
        <div className="flex flex-wrap gap-2">
          {canEdit && <Button ref={saveButtonRef} type="submit" loading={mutation.isPending} disabled={disabled || !changed}>Save changes</Button>}
          <Button type="button" variant="secondary" disabled={busy} loading={reloading} onClick={() => { setReloading(true); void onReload().finally(() => setReloading(false)); }}>Reload settings</Button>
        </div>
      </form>
      <ConfirmDialog open={confirmLive} onOpenChange={(open) => { if (!busy) setConfirmLive(open); }} onCloseAutoFocus={(event) => {
        // The controlled dialog has no Radix trigger. Return to the invoker only
        // while this editor remains mounted and its Save action is available.
        const button = saveButtonRef.current;
        if (button?.isConnected && !button.disabled) {
          event.preventDefault();
          button.focus();
        }
      }} title="Activate Live Mode?" description="Future enabled workflows may use actual GST details and consume paid credits. This change performs no lookup or government filing." confirmLabel="Activate Live Mode" loading={mutation.isPending} onConfirm={() => void save(true)} />
    </Panel>
  );
}
