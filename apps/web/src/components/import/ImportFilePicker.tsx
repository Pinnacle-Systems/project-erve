import { useRef } from 'react';
import { Button } from '@erve/primitives';

export interface ImportFilePickerProps {
  accept: string;
  ariaLabel: string;
  file: File | null;
  disabled?: boolean;
  onSelect: (file: File | null) => void;
}

/**
 * A clear, keyboard-accessible file selection action for import workflows.
 * The native input retains its format restrictions; the visible button opens
 * the same browser picker, while the filename is shown separately.
 */
export function ImportFilePicker({
  accept,
  ariaLabel,
  file,
  disabled = false,
  onSelect,
}: ImportFilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        aria-label={ariaLabel}
        disabled={disabled}
        hidden
        onChange={(event) => {
          onSelect(event.currentTarget.files?.[0] ?? null);
          // Allow choosing the same filename again after a validation error.
          event.currentTarget.value = '';
        }}
      />
      <Button type="button" variant="secondary" disabled={disabled} onClick={() => inputRef.current?.click()}>
        Choose file
      </Button>
      <span className="min-w-0 max-w-64 truncate text-sm text-muted-foreground" title={file?.name ?? 'No file selected'} role="status">
        {file?.name ?? 'No file selected'}
      </span>
    </div>
  );
}
