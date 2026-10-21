/** Exact opt-in for the user's new disposable Phase 1B environment only. */
export function requirePhase1bQaDatabase(
  value: string | undefined,
  authorized: string | undefined,
): string {
  if (authorized !== 'true' || !value)
    throw new Error('Explicit Phase 1B QA database authorization is required');
  const url = new URL(value);
  if (
    url.protocol !== 'postgresql:' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '55433' ||
    url.pathname !== '/erve_gst_phase1b_qa' ||
    url.username !== 'gstphase1b' ||
    url.search ||
    url.hash
  )
    throw new Error('Refusing database access outside the authorized disposable Phase 1B target');
  return value;
}
