export interface StyleIdentityUnavailableProps {
  size?: number;
  /** Shown as a tooltip/accessible label — explain *why*, not just that it's missing. */
  reason?: string;
}

const DEFAULT_SIZE = 40;

/**
 * The explicit "Style identity couldn't be resolved" state — distinct from
 * StyleThumbnailCell's own "no image uploaded yet" placeholder. Used where a
 * Job Order's lines disagree on Style (see resolveJobOrderPrimaryStyle):
 * that is a genuine data inconsistency, never silently rendered as nothing
 * and never confused with "this Style simply has no photo".
 */
export function StyleIdentityUnavailable({
  size = DEFAULT_SIZE,
  reason = 'Style identity unavailable — this record has inconsistent Style data.',
}: StyleIdentityUnavailableProps) {
  return (
    <div
      role="img"
      aria-label={reason}
      title={reason}
      className="flex items-center justify-center overflow-hidden rounded-[var(--erp-radius-sm)] border border-[color:var(--erp-validation-warning-border)] bg-[color:var(--erp-validation-warning-bg)]"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-1/2 w-1/2 text-[color:var(--erp-validation-warning-icon)]"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        aria-hidden="true"
      >
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      </svg>
    </div>
  );
}
