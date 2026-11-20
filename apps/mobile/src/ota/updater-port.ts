import { CapacitorUpdater, type BundleInfo } from '@capgo/capacitor-updater';

/**
 * The narrow slice of @capgo/capacitor-updater the OTA service depends on.
 * Keeping it behind an interface means the service is exercised in unit tests
 * against a fake, and a plugin upgrade only has to be reconciled here.
 */
export type OtaBundleInfo = Pick<BundleInfo, 'id' | 'version' | 'status'>;

export interface UpdaterPort {
  /** Native "builtin version" string; carries the native fingerprint. */
  getBuiltinVersion(): Promise<string>;
  current(): Promise<OtaBundleInfo>;
  list(): Promise<OtaBundleInfo[]>;
  download(options: {
    url: string;
    version: string;
    checksum: string;
    sessionKey: string;
  }): Promise<OtaBundleInfo>;
  /** Activates a downloaded bundle and reloads the WebView. */
  set(bundleId: string): Promise<void>;
  delete(bundleId: string): Promise<void>;
  /** Reverts to the bundle embedded in the APK and reloads. */
  reset(): Promise<void>;
  /** Confirms the running bundle is healthy; cancels the native rollback timer. */
  notifyAppReady(): Promise<void>;
  /** One-shot: the bundle that was rolled back since last asked, if any. */
  getFailedUpdate(): Promise<OtaBundleInfo | null>;
}

function summarise(bundle: BundleInfo): OtaBundleInfo {
  return { id: bundle.id, version: bundle.version, status: bundle.status };
}

export const capgoUpdaterPort: UpdaterPort = {
  async getBuiltinVersion() {
    return (await CapacitorUpdater.getBuiltinVersion()).version;
  },
  async current() {
    return summarise((await CapacitorUpdater.current()).bundle);
  },
  async list() {
    return (await CapacitorUpdater.list()).bundles.map(summarise);
  },
  async download(options) {
    return summarise(await CapacitorUpdater.download(options));
  },
  async set(bundleId) {
    await CapacitorUpdater.set({ id: bundleId });
  },
  async delete(bundleId) {
    await CapacitorUpdater.delete({ id: bundleId });
  },
  async reset() {
    await CapacitorUpdater.reset();
  },
  async notifyAppReady() {
    await CapacitorUpdater.notifyAppReady();
  },
  async getFailedUpdate() {
    const failed = await CapacitorUpdater.getFailedUpdate();
    return failed ? summarise(failed.bundle) : null;
  },
};
