import { Button } from '@erve/primitives';

export interface PdfActionButtonsProps {
  isGenerating: boolean;
  error: string | null;
  onDownload: () => void;
  onPrint: () => void;
  /** Short label used in the Download button text, e.g. "Download PDF" (default) or "Download". */
  downloadLabel?: string;
}

/** Shared Print / Download PDF action pair, with loading and inline error states. */
export function PdfActionButtons({
  isGenerating,
  error,
  onDownload,
  onPrint,
  downloadLabel = 'Download PDF',
}: PdfActionButtonsProps) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={onDownload} disabled={isGenerating}>
          {isGenerating ? 'Generating…' : downloadLabel}
        </Button>
        <Button variant="secondary" onClick={onPrint} disabled={isGenerating}>
          Print
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
