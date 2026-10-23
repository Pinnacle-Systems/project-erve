import { useState } from 'react';
import type { ApiSuccessResponse } from '@erve/types';
import { Button, ValidationMessage } from '@erve/primitives';
import { ConfirmDialog } from '@erve/app-components';
import { apiClient } from '../../../lib/api-client.js';
import { getApiErrorMessage } from '../../../lib/api-errors.js';
import type { HsnDescriptionRefreshPreview, StagedHsnDescriptionRefresh } from '../types.js';

export interface HsnDescriptionRefreshProps {
  /** Only rendered in edit mode - there is no saved Style to refresh against on create. */
  styleId: string;
  /** Any staged-but-unsaved refresh, lifted into StyleFormPage's form state. */
  staged: StagedHsnDescriptionRefresh | null;
  onStage: (value: StagedHsnDescriptionRefresh | null) => void;
}

/**
 * ISS-062: "Refresh HSN Description" - prepares a preview of the Style's
 * linked Hsn's CURRENT description against the Style's saved snapshot,
 * shows a before/after ConfirmDialog, and on confirm STAGES the new value
 * into the in-progress edit form (never an immediate PATCH) so it saves
 * atomically with the rest of the user's pending edits via the normal Save
 * Style action. Modeled on GstinVerificationPanel's SavedVerification
 * prepare -> confirm pattern.
 */
export function HsnDescriptionRefresh({ styleId, staged, onStage }: HsnDescriptionRefreshProps) {
  const [preview, setPreview] = useState<HsnDescriptionRefreshPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function prepare() {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const result = (
        await apiClient.get<ApiSuccessResponse<HsnDescriptionRefreshPreview>>(
          `/styles/${styleId}/hsn-description-refresh`,
        )
      ).data.data;
      if (!result.canRefresh) {
        setInfo('This Style has no HSN selected. There is no description to refresh.');
        return;
      }
      if (!result.isStale) {
        setInfo('HSN description is already up to date.');
        return;
      }
      setPreview(result);
    } catch (caught) {
      setError(getApiErrorMessage(caught, 'Unable to check the HSN description. Saving remains available.'));
    } finally {
      setBusy(false);
    }
  }

  function confirm() {
    if (!preview) return;
    onStage({ hsnId: preview.hsnId!, expectedDescription: preview.proposedDescription });
    setPreview(null);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void prepare()}>
          Refresh HSN Description
        </Button>
        {staged ? (
          <>
            <span className="text-xs text-muted-foreground">
              A refreshed description is staged - it will save with the rest of this edit.
            </span>
            <Button type="button" variant="ghost" onClick={() => onStage(null)}>
              Undo staged refresh
            </Button>
          </>
        ) : null}
      </div>
      {info ? <p className="text-xs text-muted-foreground">{info}</p> : null}
      {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
      <ConfirmDialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
        title="Refresh HSN Description"
        description={
          preview
            ? `Current: "${preview.currentDescription ?? '(blank)'}". Proposed: "${preview.proposedDescription ?? '(blank)'}". This will be staged into this edit and saved when you Save Style.`
            : ''
        }
        confirmLabel="Stage refresh"
        onConfirm={confirm}
      />
    </div>
  );
}
