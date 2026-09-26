import { useEffect, useState } from 'react';

/**
 * Asks the browser to confirm before a reload, tab close or window close
 * while `dirty` is true. The browser shows its own generic prompt; the text
 * cannot be customised. In-app route changes are not intercepted (that
 * would need a data router) — see docs/SESSION_MANAGEMENT.md.
 */
export function useUnsavedChangesWarning(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy browsers only prompt when returnValue is set.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
}

/**
 * True once `snapshot` differs from its value at the first render where
 * `ready` was true (e.g. after an edit form hydrated from its record). The
 * snapshot must be JSON-serialisable and contain only user-entered state.
 */
export function useFormDirty(snapshot: unknown, ready = true): boolean {
  const signature = JSON.stringify(snapshot);
  const [baseline, setBaseline] = useState<string | null>(ready ? signature : null);
  // Render-time capture of the baseline once the form is ready.
  if (ready && baseline === null) {
    setBaseline(signature);
  }
  return baseline !== null && signature !== baseline;
}
