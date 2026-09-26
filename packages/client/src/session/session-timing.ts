import type { SessionInfo } from '@erve/types';

/**
 * Server-authoritative session timing, normalised to epoch milliseconds.
 * `clockOffsetMs` (server clock minus this device's clock, measured when the
 * timing was received) lets callers compare the server instants with
 * `Date.now()` despite local clock skew. Clients only use this to schedule
 * renewal and warnings — the server alone decides whether a session is valid.
 */
export interface SessionTiming {
  userId: string;
  accessExpiresAt: number;
  idleExpiresAt: number;
  absoluteExpiresAt: number;
  idleTimeoutMs: number;
  clockOffsetMs: number;
}

export interface SessionTimingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SESSION_TIMING_STORAGE_KEY = 'erve.sessionTiming';

type SessionTimingListener = (timing: SessionTiming | null) => void;

let storage: SessionTimingStorage | null = null;
let current: SessionTiming | null = null;
const listeners = new Set<SessionTimingListener>();

export function toSessionTiming(info: SessionInfo, receivedAt = Date.now()): SessionTiming {
  return {
    userId: info.userId,
    accessExpiresAt: Date.parse(info.accessExpiresAt),
    idleExpiresAt: Date.parse(info.idleExpiresAt),
    absoluteExpiresAt: Date.parse(info.absoluteExpiresAt),
    idleTimeoutMs: info.idleTimeoutSeconds * 1000,
    clockOffsetMs: Date.parse(info.serverTime) - receivedAt,
  };
}

function isSessionTiming(value: unknown): value is SessionTiming {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.userId === 'string' &&
    [
      'accessExpiresAt',
      'idleExpiresAt',
      'absoluteExpiresAt',
      'idleTimeoutMs',
      'clockOffsetMs',
    ].every((key) => typeof candidate[key] === 'number' && Number.isFinite(candidate[key]))
  );
}

function readStored(): SessionTiming | null {
  try {
    const raw = storage?.getItem(SESSION_TIMING_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSessionTiming(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function notify(): void {
  for (const listener of listeners) listener(current);
}

/**
 * Web persists timing in localStorage so it survives a reload and every tab
 * sees the latest value (it holds only instants and a user id — nothing
 * secret). Mobile keeps it in memory only.
 */
export function configureSessionTimingStorage(next: SessionTimingStorage | null): void {
  storage = next;
  current = readStored();
}

export function getSessionTiming(): SessionTiming | null {
  return current;
}

export function setSessionTiming(timing: SessionTiming | null): void {
  current = timing;
  try {
    if (timing) storage?.setItem(SESSION_TIMING_STORAGE_KEY, JSON.stringify(timing));
    else storage?.removeItem(SESSION_TIMING_STORAGE_KEY);
  } catch {
    // Storage full/blocked: the in-memory value is still authoritative here.
  }
  notify();
}

/** Re-reads persisted timing, e.g. after another tab wrote it (a `storage` event). */
export function reloadSessionTimingFromStorage(): void {
  const stored = readStored();
  if (JSON.stringify(stored) === JSON.stringify(current)) return;
  current = stored;
  notify();
}

export function subscribeSessionTiming(listener: SessionTimingListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
