/**
 * Update-safety guards.
 *
 * Activating an OTA bundle reloads the WebView, which destroys all in-memory
 * React state. The service therefore asks this registry "is it safe right now?"
 * immediately before every activation, and refuses if ANY source answers with a
 * reason. Sources are pull-based so a stale flag can never wedge updates: the
 * answer is computed from live state at the moment of the decision.
 *
 * Built-in sources (see useUpdateSafetyGuards.ts):
 *   - protected routes: an open QA inspection, production/job-order task
 *     detail or quality execution screen;
 *   - in-flight mutations (saves, stage updates, evidence uploads);
 *   - unsaved form input still present on screen.
 */
import type { QueryClient } from '@tanstack/react-query';
import { matchPath } from 'react-router-dom';

export type GuardSource = () => string | null;

export interface UpdateGuardView {
  /** Reason the current moment is unsafe for a reload, or null when it is safe. */
  blockingReason(): string | null;
}

export class UpdateGuardRegistry implements UpdateGuardView {
  private readonly sources = new Map<symbol, GuardSource>();
  private readonly listeners = new Set<() => void>();

  /** Registers a live source; returns an unregister function. */
  register(source: GuardSource): () => void {
    const token = Symbol('update-guard');
    this.sources.set(token, source);
    this.notify();
    return () => {
      this.sources.delete(token);
      this.notify();
    };
  }

  /** Imperative hold for code that has no natural pull-based signal. */
  hold(reason: string): () => void {
    return this.register(() => reason);
  }

  blockingReason(): string | null {
    for (const source of this.sources.values()) {
      let reason: string | null;
      try {
        reason = source();
      } catch {
        // A guard that cannot answer is treated as "unsafe": never reload blind.
        reason = 'A safety check could not be completed';
      }
      if (reason) return reason;
    }
    return null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Re-evaluate observers (e.g. the UI) after external state changed. */
  notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/**
 * Screens where a reload would interrupt operational work. Matching is by route
 * pattern, not by page internals, so this module never touches ERP workflows.
 */
export const PROTECTED_ROUTE_PATTERNS: ReadonlyArray<{ pattern: string; reason: string }> = [
  { pattern: '/qa/:id', reason: 'A QA inspection is open' },
  { pattern: '/quality-executions/:executionId', reason: 'A quality execution is open' },
  { pattern: '/factory-tasks/:id', reason: 'A production task is open' },
  { pattern: '/job-orders/:id', reason: 'A job order is open' },
];

export function protectedRouteReason(pathname: string): string | null {
  for (const { pattern, reason } of PROTECTED_ROUTE_PATTERNS) {
    if (matchPath({ path: pattern, end: true }, pathname)) return reason;
  }
  return null;
}

/**
 * A save that has been pending this long is not "in progress" any more — the
 * connection died without the request ever failing. Without a bound it would
 * hold updates until the app is restarted.
 */
export const PENDING_MUTATION_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Reads the mutation cache synchronously at decision time (not mirrored through
 * React state), so a save that started a millisecond ago is always seen.
 */
export function pendingMutationReason(
  queryClient: QueryClient,
  now: () => number = () => Date.now(),
): string | null {
  const cutoff = now() - PENDING_MUTATION_MAX_AGE_MS;
  const pending = queryClient
    .getMutationCache()
    .getAll()
    .some((mutation) => {
      const { status, submittedAt } = mutation.state;
      return status === 'pending' && (submittedAt === 0 || submittedAt >= cutoff);
    });
  return pending ? 'A save is in progress' : null;
}

const FORM_FIELD_SELECTOR = 'input, textarea, select, [contenteditable="true"]';
const NON_TEXT_INPUT_TYPES = new Set(['hidden', 'button', 'submit', 'reset', 'image']);

/**
 * Tracks form fields the user has edited. A field counts as "unsaved" while it
 * is still attached to the document; when the form unmounts (saved, cancelled,
 * navigated away) the hold disappears by itself.
 */
export class DirtyFieldTracker {
  private readonly edited = new Set<Element>();
  private cleanup: (() => void) | null = null;

  constructor(private readonly doc: Document = document) {}

  start(): () => void {
    if (this.cleanup) return this.cleanup;
    const onInput = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.matches(FORM_FIELD_SELECTOR)) return;
      if (target instanceof HTMLInputElement && NON_TEXT_INPUT_TYPES.has(target.type)) return;
      this.edited.add(target);
    };
    this.doc.addEventListener('input', onInput, true);
    this.doc.addEventListener('change', onInput, true);
    this.cleanup = () => {
      this.doc.removeEventListener('input', onInput, true);
      this.doc.removeEventListener('change', onInput, true);
      this.edited.clear();
      this.cleanup = null;
    };
    return this.cleanup;
  }

  /** Forget edits (called on navigation: a new screen starts clean). */
  reset(): void {
    this.edited.clear();
  }

  blockingReason(): string | null {
    for (const element of this.edited) {
      if (!element.isConnected) this.edited.delete(element);
    }
    return this.edited.size > 0 ? 'A form has unsaved changes' : null;
  }
}
