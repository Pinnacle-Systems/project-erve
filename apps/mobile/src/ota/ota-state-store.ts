/**
 * Small persisted bookkeeping for the OTA service.
 *
 * This is deliberately NOT the source of truth for what is installed — the
 * native updater is. It only remembers things the plugin cannot: builds that
 * failed on this device (so a bad release is never re-downloaded in a loop),
 * the newest manifest sequence seen (replay protection), per-build download
 * failure backoff, and the last check result shown in the UI.
 *
 * Losing it (cleared storage) is harmless: the worst case is one retry of a
 * previously failed build, which the native rollback again contains.
 */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type OtaCheckOutcome =
  | 'up-to-date'
  | 'update-staged'
  | 'offline'
  | 'server-unavailable'
  | 'invalid-manifest'
  | 'download-failed'
  | 'native-update-required'
  | 'skipped'
  | 'disabled';

export interface OtaCheckRecord {
  at: number;
  outcome: OtaCheckOutcome;
  message: string;
}

export interface OtaNotice {
  kind: 'rolled-back' | 'native-mismatch' | 'activation-failed';
  version: string;
  at: number;
}

/** Written immediately before a bundle is activated; cleared only once it confirms it is healthy. */
export interface OtaPendingActivation {
  buildNumber: number;
  version: string;
  at: number;
}

export interface OtaPersistedState {
  /**
   * Own ledger of "I asked for build N to be activated". If a later startup
   * finds this set while a different bundle is running, the activation did not
   * stick (crash, failed reload, native rollback) — independent of whether the
   * plugin reports the failure, which not every rollback path does.
   */
  pendingActivation: OtaPendingActivation | null;
  highestSequence: number;
  failedBuilds: number[];
  downloadFailures: Record<string, { count: number; lastAt: number }>;
  lastCheck: OtaCheckRecord | null;
  notice: OtaNotice | null;
}

const STORAGE_KEY = 'erve.ota.state.v1';
const MAX_FAILED_BUILDS = 50;

export function emptyState(): OtaPersistedState {
  return {
    pendingActivation: null,
    highestSequence: 0,
    failedBuilds: [],
    downloadFailures: {},
    lastCheck: null,
    notice: null,
  };
}

export class OtaStateStore {
  private state: OtaPersistedState;

  constructor(private readonly storage: KeyValueStorage | null) {
    this.state = this.load();
  }

  private load(): OtaPersistedState {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw) as Partial<OtaPersistedState>;
      const pending = parsed.pendingActivation;
      return {
        pendingActivation:
          pending &&
          Number.isSafeInteger(pending.buildNumber) &&
          typeof pending.version === 'string'
            ? pending
            : null,
        highestSequence: Number.isSafeInteger(parsed.highestSequence)
          ? (parsed.highestSequence as number)
          : 0,
        failedBuilds: Array.isArray(parsed.failedBuilds)
          ? parsed.failedBuilds.filter((value) => Number.isSafeInteger(value))
          : [],
        downloadFailures:
          parsed.downloadFailures && typeof parsed.downloadFailures === 'object'
            ? parsed.downloadFailures
            : {},
        lastCheck: parsed.lastCheck ?? null,
        notice: parsed.notice ?? null,
      };
    } catch {
      return emptyState();
    }
  }

  private persist(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      /* storage unavailable/full: bookkeeping is best-effort by design */
    }
  }

  get snapshot(): Readonly<OtaPersistedState> {
    return this.state;
  }

  update(mutator: (state: OtaPersistedState) => void): void {
    mutator(this.state);
    if (this.state.failedBuilds.length > MAX_FAILED_BUILDS) {
      this.state.failedBuilds = this.state.failedBuilds.slice(-MAX_FAILED_BUILDS);
    }
    this.persist();
  }

  isFailedBuild(buildNumber: number): boolean {
    return this.state.failedBuilds.includes(buildNumber);
  }

  markFailedBuild(buildNumber: number): void {
    if (buildNumber > 0 && !this.isFailedBuild(buildNumber)) {
      this.update((state) => state.failedBuilds.push(buildNumber));
    }
  }
}
