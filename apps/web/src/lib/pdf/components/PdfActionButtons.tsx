import { Button, type ButtonDensity } from '@erve/primitives';

export interface PdfActionButtonsProps {
  isGenerating: boolean;
  error: string | null;
  onDownload: () => void;
  onPrint: () => void;
  /** Short label used in the Download button text, e.g. "Download PDF" (default) or "Download". */
  downloadLabel?: string;
  /** Short label used in the Print button text, e.g. "Print" (default) or "Print Label". */
  printLabel?: string;
  /** When true, both actions are disabled regardless of isGenerating (e.g. a precondition, like a required approval, isn't met yet). */
  disabled?: boolean;
  /** Shown as a native title/tooltip on the action pair while `disabled` is true, explaining why. */
  disabledHint?: string;
  /** Shrinks the buttons for inline use next to other compact row controls (e.g. a table row's own actions). Omit for the existing page-header-sized default. */
  density?: ButtonDensity;
}

/** Shared Print / Download PDF action pair, with loading and inline error states. */
export function PdfActionButtons({
  isGenerating,
  error,
  onDownload,
  onPrint,
  downloadLabel = 'Download PDF',
  printLabel = 'Print',
  disabled = false,
  disabledHint,
  density,
}: PdfActionButtonsProps) {
  const isDisabled = isGenerating || disabled;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2" title={disabled ? disabledHint : undefined}>
        <Button variant="secondary" density={density} onClick={onDownload} disabled={isDisabled}>
          {isGenerating ? 'Generating…' : downloadLabel}
        </Button>
        <Button variant="secondary" density={density} onClick={onPrint} disabled={isDisabled}>
          {printLabel}
        </Button>
      </div>
      {error ? (
        <span className="text-xs text-danger" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
