import type { OtaBuildConfig } from './ota-config.js';
import {
  ManifestError,
  appVersionFromReleaseVersion,
  buildNumberFromVersion,
  isNewerAppVersion,
  resolveReleaseUrl,
  verifyAndParseManifest,
  type OtaManifest,
  type OtaRelease,
} from './manifest.js';
import {
  OtaStateStore,
  type OtaCheckOutcome,
  type OtaCheckRecord,
  type OtaNotice,
} from './ota-state-store.js';
import type { OtaBundleInfo, UpdaterPort } from './updater-port.js';
import type { UpdateGuardView } from './update-guards.js';

export type OtaTrigger = 'launch' | 'resume' | 'manual';
export type OtaPhase = 'disabled' | 'idle' | 'checking' | 'downloading' | 'activating';

export interface OtaStagedUpdate {
  bundleId: string;
  version: string;
  buildNumber: number;
}

export interface OtaStatus {
  phase: OtaPhase;
  enabled: boolean;
  /** Why OTA is off (only meaningful when `enabled` is false). */
  disabledReason: string;
  /** Version of the web bundle currently running ("embedded" for the APK's own). */
  currentVersion: string;
  currentBuildNumber: number;
  /** Release channel this APK follows ("production" or "testing"); null until known. */
  channel: string | null;
  /** Version and native-layer fingerprint of the installed APK; null until known. */
  native: { appVersion: string; fingerprint: string } | null;
  staged: OtaStagedUpdate | null;
  /** Why the staged update cannot be activated right now, if it cannot. */
  blockedBy: string | null;
  /** No compatible bundle exists for this APK; a newer APK has to be installed. */
  nativeUpdateRequired: boolean;
  /** This APK still gets web updates, but a newer APK generation exists. */
  newerApkAvailable: boolean;
  lastCheck: OtaCheckRecord | null;
  notice: OtaNotice | null;
}

export interface OtaServiceDeps {
  config: OtaBuildConfig;
  updater: UpdaterPort;
  /**
   * GET a JSON document. On device this is Capacitor's native HTTP client (no
   * WebView CORS preflight against the update host); tests inject a fake.
   * Rejects on any transport failure; resolves with the status for HTTP errors.
   */
  httpGetJson: (
    url: string,
    options: { timeoutMs: number },
  ) => Promise<{ status: number; data: unknown }>;
  store: OtaStateStore;
  guards: UpdateGuardView;
  /** False in browsers/tests: the service stays disabled and touches nothing. */
  isNative: boolean;
  now?: () => number;
  isOnline?: () => boolean;
  manifestTimeoutMs?: number;
  downloadTimeoutMs?: number;
  startupBudgetMs?: number;
  log?: (message: string, detail?: unknown) => void;
}

const NATIVE_IDENTITY_SUFFIX = /^(.*)-erve-native\.([0-9a-f]{32})\.([a-z0-9][a-z0-9_-]{0,31})$/;
const KNOWN_CHANNELS = ['testing', 'production'];
const BUILTIN_BUNDLE_ID = 'builtin';
const MIN_INTERVAL_MS: Record<OtaTrigger, number> = {
  launch: 60_000,
  resume: 5 * 60_000,
  manual: 0,
};
const MAX_DOWNLOAD_FAILURES = 3;
const FAILURE_BACKOFF_MS = 6 * 60 * 60_000;

export interface NativeIdentity {
  /** Version of the installed APK, e.g. "0.1.0". */
  appVersion: string;
  fingerprint: string;
  channel: string;
}

/**
 * The APK reports `<appVersion>-erve-native.<fingerprint>.<channel>` as its
 * builtin version. Both parts come from the installed APK, never from the
 * replaceable web bundle, so an OTA bundle cannot change which native layer or
 * release channel a device believes it is on.
 */
export function parseNativeIdentity(
  builtinVersion: string | null | undefined,
): NativeIdentity | null {
  const [, appVersion, fingerprint, channel] =
    NATIVE_IDENTITY_SUFFIX.exec(builtinVersion ?? '') ?? [];
  if (!appVersion || !fingerprint || !channel || !KNOWN_CHANNELS.includes(channel)) return null;
  return { appVersion, fingerprint, channel };
}

export function parseNativeFingerprint(builtinVersion: string | null | undefined): string | null {
  return parseNativeIdentity(builtinVersion)?.fingerprint ?? null;
}

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new TimeoutError(`${label} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export class OtaUpdateService {
  private status: OtaStatus;
  private readonly listeners = new Set<() => void>();
  private inflight: Promise<OtaCheckRecord> | null = null;
  private readonly now: () => number;
  private readonly isOnline: () => boolean;
  private readonly log: (message: string, detail?: unknown) => void;
  private deviceFingerprint: string | null = null;
  private deviceChannel: string | null = null;

  constructor(private readonly deps: OtaServiceDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.isOnline =
      deps.isOnline ??
      (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
    this.log = deps.log ?? (() => undefined);
    const persisted = deps.store.snapshot;
    this.status = {
      phase: deps.isNative && deps.config.enabled ? 'idle' : 'disabled',
      enabled: deps.isNative && deps.config.enabled,
      disabledReason: deps.isNative
        ? deps.config.disabledReason
        : 'Not running as the packaged app',
      currentVersion: 'embedded',
      currentBuildNumber: 0,
      channel: null,
      native: null,
      staged: null,
      blockedBy: null,
      nativeUpdateRequired: false,
      newerApkAvailable: false,
      lastCheck: persisted.lastCheck,
      notice: persisted.notice,
    };
  }

  // ---- observable state -------------------------------------------------

  getStatus = (): OtaStatus => this.status;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private patch(changes: Partial<OtaStatus>): void {
    const next = { ...this.status, ...changes };
    const changed = (Object.keys(next) as Array<keyof OtaStatus>).some(
      (key) => next[key] !== this.status[key],
    );
    if (!changed) return;
    this.status = next;
    for (const listener of this.listeners) listener();
  }

  private disable(reason: string): void {
    this.patch({ phase: 'disabled', enabled: false, disabledReason: reason });
  }

  /** Recomputes whether a staged update is currently blocked (called when guards change). */
  refreshGuardState(): void {
    this.patch({ blockedBy: this.status.staged ? this.deps.guards.blockingReason() : null });
  }

  dismissNotice(): void {
    this.deps.store.update((state) => {
      state.notice = null;
    });
    this.patch({ notice: null });
  }

  private setNotice(kind: OtaNotice['kind'], version: string): void {
    const notice: OtaNotice = { kind, version, at: this.now() };
    this.deps.store.update((state) => {
      state.notice = notice;
    });
    this.patch({ notice });
  }

  // ---- startup ----------------------------------------------------------

  /**
   * Runs before React renders. Verifies this bundle matches the device's native
   * layer, records any rollback, and — only here, at a cold start where there
   * is no in-memory work to lose — activates a bundle staged earlier.
   * Never throws; a hung or failing plugin cannot block app launch.
   */
  async runStartup(): Promise<{ reloading: boolean }> {
    if (!this.deps.isNative) return { reloading: false };
    try {
      return await withTimeout(this.startup(), this.deps.startupBudgetMs ?? 4000, 'OTA startup');
    } catch (error) {
      this.log('startup skipped', error);
      return { reloading: false };
    }
  }

  private async startup(): Promise<{ reloading: boolean }> {
    const { config, updater, store } = this.deps;
    const [builtinVersion, current] = await Promise.all([
      updater.getBuiltinVersion(),
      updater.current(),
    ]);
    const identity = parseNativeIdentity(builtinVersion);
    this.deviceFingerprint = identity?.fingerprint ?? null;
    this.deviceChannel = identity?.channel ?? null;
    this.patch({
      channel: this.deviceChannel,
      native: identity
        ? { appVersion: identity.appVersion, fingerprint: identity.fingerprint }
        : null,
      currentVersion: current.id === BUILTIN_BUNDLE_ID ? 'embedded' : current.version,
      currentBuildNumber:
        current.id === BUILTIN_BUNDLE_ID ? 0 : buildNumberFromVersion(current.version),
    });

    if (!config.nativeFingerprint) {
      this.disable('This bundle carries no native fingerprint');
      return { reloading: false };
    }
    if (!this.deviceFingerprint) {
      this.disable('The installed APK does not report a native fingerprint');
      return { reloading: false };
    }
    if (this.deviceFingerprint !== config.nativeFingerprint) {
      // This bundle was built for a different native layer than the one it is
      // running on (e.g. a new APK was side-loaded over an old one without the
      // plugin's own version-based reset firing). Never keep running it.
      this.log('native fingerprint mismatch', {
        device: this.deviceFingerprint,
        bundle: config.nativeFingerprint,
      });
      if (current.id !== BUILTIN_BUNDLE_ID) {
        this.setNotice('native-mismatch', current.version);
        await updater.reset();
        return { reloading: true };
      }
      this.disable('Embedded bundle does not match the installed native layer');
      return { reloading: false };
    }

    const failed = await updater.getFailedUpdate();
    if (failed) {
      store.markFailedBuild(buildNumberFromVersion(failed.version));
      this.setNotice('rolled-back', failed.version);
      this.log('previous update was rolled back', failed);
    }

    // Ledger check: we asked for a build to be activated but it is not what is
    // running now, so it crashed, failed to load, or was rolled back natively.
    const attempted = store.snapshot.pendingActivation;
    if (attempted && attempted.buildNumber !== this.status.currentBuildNumber) {
      store.markFailedBuild(attempted.buildNumber);
      store.update((state) => {
        state.pendingActivation = null;
      });
      this.setNotice('rolled-back', attempted.version);
      this.log('activation did not stick; build marked failed', attempted);
    }

    if (!config.enabled) {
      this.disable(config.disabledReason);
      return { reloading: false };
    }

    const staged = await this.reconcileBundles(current);
    if (staged && !this.deps.guards.blockingReason()) {
      return { reloading: await this.activate(staged) };
    }
    return { reloading: false };
  }

  /**
   * Picks the staged bundle (if eligible) and removes leftovers so storage
   * cannot grow without bound. While the current bundle is still unconfirmed
   * the previous-good rollback target is left strictly alone.
   */
  private async reconcileBundles(current: OtaBundleInfo): Promise<OtaStagedUpdate | null> {
    const { updater, store } = this.deps;
    const bundles = await updater.list();
    const currentBuild = this.status.currentBuildNumber;
    const candidates = bundles
      .filter((bundle) => bundle.id !== BUILTIN_BUNDLE_ID && bundle.id !== current.id)
      .filter((bundle) => bundle.status === 'pending')
      .map((bundle) => ({
        bundleId: bundle.id,
        version: bundle.version,
        buildNumber: buildNumberFromVersion(bundle.version),
      }))
      .filter(
        (candidate) =>
          candidate.buildNumber > currentBuild && !store.isFailedBuild(candidate.buildNumber),
      )
      .sort((a, b) => b.buildNumber - a.buildNumber);
    const staged = candidates[0] ?? null;

    if (current.id === BUILTIN_BUNDLE_ID || current.status === 'success') {
      for (const bundle of bundles) {
        if (bundle.id === BUILTIN_BUNDLE_ID || bundle.id === current.id) continue;
        if (staged && bundle.id === staged.bundleId) continue;
        await updater
          .delete(bundle.id)
          .catch((error: unknown) => this.log('cleanup failed', error));
      }
    }
    this.patch({ staged, blockedBy: staged ? this.deps.guards.blockingReason() : null });
    return staged;
  }

  /** Called once the new UI has mounted: cancels the native rollback timer. */
  async markReady(): Promise<void> {
    if (!this.deps.isNative) return;
    try {
      await this.deps.updater.notifyAppReady();
      // Healthy: if this is the bundle we activated, the attempt is complete.
      const attempted = this.deps.store.snapshot.pendingActivation;
      if (attempted && attempted.buildNumber === this.status.currentBuildNumber) {
        this.deps.store.update((state) => {
          state.pendingActivation = null;
        });
      }
    } catch (error) {
      this.log('notifyAppReady failed', error);
    }
  }

  // ---- activation -------------------------------------------------------

  private async activate(staged: OtaStagedUpdate): Promise<boolean> {
    this.patch({ phase: 'activating' });
    // Recorded BEFORE the reload so the next startup can tell whether it stuck.
    this.deps.store.update((state) => {
      state.pendingActivation = {
        buildNumber: staged.buildNumber,
        version: staged.version,
        at: this.now(),
      };
    });
    try {
      // On success the WebView reloads and this context is destroyed.
      await this.deps.updater.set(staged.bundleId);
      return true;
    } catch (error) {
      this.log('activation failed', error);
      this.deps.store.update((state) => {
        state.pendingActivation = null;
      });
      this.deps.store.markFailedBuild(staged.buildNumber);
      await this.deps.updater.delete(staged.bundleId).catch(() => undefined);
      this.setNotice('activation-failed', staged.version);
      this.patch({ phase: 'idle', staged: null, blockedBy: null });
      return false;
    }
  }

  /** Activates the staged bundle only if no guard objects. Returns whether a reload started. */
  async activateStagedIfSafe(): Promise<boolean> {
    const { staged } = this.status;
    if (!staged || this.status.phase === 'activating') return false;
    const reason = this.deps.guards.blockingReason();
    if (reason) {
      this.patch({ blockedBy: reason });
      return false;
    }
    return this.activate(staged);
  }

  /** App returned to the foreground: apply a staged bundle if safe, else check for a newer one. */
  async onResume(): Promise<void> {
    if (!this.status.enabled) return;
    if (await this.activateStagedIfSafe()) return;
    await this.checkForUpdate('resume');
  }

  // ---- checking ---------------------------------------------------------

  private manifestUrl(): string {
    const { baseUrl } = this.deps.config;
    return `${baseUrl}/${this.deviceChannel}/manifest.json`;
  }

  checkForUpdate(trigger: OtaTrigger): Promise<OtaCheckRecord> {
    if (!this.status.enabled) {
      return Promise.resolve({
        at: this.now(),
        outcome: 'disabled',
        message: this.status.disabledReason,
      });
    }
    if (!this.deviceChannel) {
      // Startup has not (or could not) identify this APK's channel; never guess one.
      return Promise.resolve({
        at: this.now(),
        outcome: 'disabled',
        message: 'This app installation has not reported its update channel yet.',
      });
    }
    if (this.inflight) return this.inflight;
    const last = this.status.lastCheck;
    if (last && trigger !== 'manual' && this.now() - last.at < MIN_INTERVAL_MS[trigger]) {
      return Promise.resolve(last);
    }
    this.inflight = this.runCheck().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private record(outcome: OtaCheckOutcome, message: string): OtaCheckRecord {
    const record: OtaCheckRecord = { at: this.now(), outcome, message };
    this.deps.store.update((state) => {
      state.lastCheck = record;
    });
    this.patch({ lastCheck: record, phase: this.status.enabled ? 'idle' : this.status.phase });
    return record;
  }

  private async fetchManifest(): Promise<OtaManifest | OtaCheckRecord> {
    const { config, httpGetJson } = this.deps;
    if (!this.isOnline())
      return this.record('offline', 'No internet connection. Will retry later.');

    let response: { status: number; data: unknown };
    try {
      response = await httpGetJson(this.manifestUrl(), {
        timeoutMs: this.deps.manifestTimeoutMs ?? 15_000,
      });
    } catch (error) {
      this.log('manifest fetch failed', error);
      return this.isOnline()
        ? this.record('server-unavailable', "Can't reach the update server. Will retry later.")
        : this.record('offline', 'No internet connection. Will retry later.');
    }

    if (response.status === 404) {
      return this.record('up-to-date', 'No updates have been published yet.');
    }
    if (response.status < 200 || response.status >= 300) {
      return this.record(
        'server-unavailable',
        `The update server returned an error (${response.status}).`,
      );
    }
    try {
      const envelope: unknown =
        typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      const manifest = await verifyAndParseManifest(
        envelope,
        config.publicKey,
        this.deviceChannel ?? '',
      );
      if (manifest.sequence < this.deps.store.snapshot.highestSequence) {
        return this.record(
          'invalid-manifest',
          'Ignored an update list older than one already seen.',
        );
      }
      this.deps.store.update((state) => {
        state.highestSequence = Math.max(state.highestSequence, manifest.sequence);
      });
      return manifest;
    } catch (error) {
      this.log('manifest rejected', error);
      const reason = error instanceof ManifestError ? error.code : 'unreadable';
      return this.record('invalid-manifest', `The update list was rejected (${reason}).`);
    }
  }

  private async runCheck(): Promise<OtaCheckRecord> {
    this.patch({ phase: 'checking' });
    try {
      const manifest = await this.fetchManifest();
      if ('outcome' in manifest) return manifest;

      const fingerprint = this.deps.config.nativeFingerprint;
      const release = manifest.releases[fingerprint];
      // A different "latest" generation normally means this APK is the old one.
      // But a brand-new APK can be installed BEFORE its first release is
      // published; then this device is the newer one and must not be told to
      // install an app it already has. The latest release records the app
      // version it was published under, which orders the two generations.
      const latestRelease = manifest.releases[manifest.latestNativeFingerprint];
      const deviceIsNewer =
        !!this.status.native &&
        isNewerAppVersion(
          this.status.native.appVersion,
          appVersionFromReleaseVersion(latestRelease?.version),
        );
      const newerApkAvailable = manifest.latestNativeFingerprint !== fingerprint && !deviceIsNewer;
      this.patch({ newerApkAvailable, nativeUpdateRequired: !release && newerApkAvailable });

      if (!release) {
        return newerApkAvailable
          ? this.record('native-update-required', 'A new version of the app must be installed.')
          : this.record('up-to-date', 'The app is up to date.');
      }
      return await this.stageRelease(release);
    } catch (error) {
      this.log('update check failed', error);
      return this.record('server-unavailable', 'The update check failed. Will retry later.');
    }
  }

  private async stageRelease(release: OtaRelease): Promise<OtaCheckRecord> {
    const { store, updater, config } = this.deps;
    if (release.buildNumber <= this.status.currentBuildNumber) {
      return this.record('up-to-date', 'The app is up to date.');
    }
    if (this.status.staged && this.status.staged.buildNumber >= release.buildNumber) {
      return this.record(
        'update-staged',
        'An update is ready and will install at the next safe moment.',
      );
    }
    if (store.isFailedBuild(release.buildNumber)) {
      return this.record(
        'skipped',
        'The latest update failed on this device earlier and was skipped.',
      );
    }
    const failures = store.snapshot.downloadFailures[String(release.buildNumber)];
    if (
      failures &&
      failures.count >= MAX_DOWNLOAD_FAILURES &&
      this.now() - failures.lastAt < FAILURE_BACKOFF_MS
    ) {
      return this.record('skipped', 'The update download failed repeatedly. Will retry later.');
    }

    let url: string;
    try {
      url = resolveReleaseUrl(release.url, this.manifestUrl(), {
        allowInsecureHttp: config.allowInsecureHttp,
      });
    } catch (error) {
      this.log('release url rejected', error);
      return this.record('invalid-manifest', 'The update list pointed at an untrusted address.');
    }

    this.patch({ phase: 'downloading' });
    let bundle: OtaBundleInfo;
    try {
      bundle = await withTimeout(
        updater.download({
          url,
          version: release.version,
          checksum: release.checksum,
          sessionKey: release.sessionKey,
        }),
        this.deps.downloadTimeoutMs ?? 5 * 60_000,
        'OTA download',
      );
    } catch (error) {
      this.log('download failed', error);
      store.update((state) => {
        const key = String(release.buildNumber);
        const previous = state.downloadFailures[key];
        state.downloadFailures[key] = { count: (previous?.count ?? 0) + 1, lastAt: this.now() };
      });
      if (!this.isOnline())
        return this.record('offline', 'The connection dropped during the update download.');
      const text = error instanceof Error ? error.message : String(error);
      return /checksum|session key|decrypt|verif/i.test(text)
        ? this.record(
            'download-failed',
            'The downloaded update failed verification and was discarded.',
          )
        : this.record('download-failed', 'The update download failed. Will retry later.');
    }

    // Anything older that is still staged is superseded.
    const previous = this.status.staged;
    if (previous && previous.bundleId !== bundle.id) {
      await updater.delete(previous.bundleId).catch(() => undefined);
    }
    store.update((state) => {
      delete state.downloadFailures[String(release.buildNumber)];
    });
    const staged: OtaStagedUpdate = {
      bundleId: bundle.id,
      version: release.version,
      buildNumber: release.buildNumber,
    };
    this.patch({ staged, blockedBy: this.deps.guards.blockingReason() });
    return this.record(
      'update-staged',
      'An update is ready and will install at the next safe moment.',
    );
  }
}
