/**
 * Compile-time OTA constants. They are injected by vite.config.ts from the same
 * scripts/ota/ota-config.mjs the native Capacitor config is built from, so the
 * web bundle and the APK always agree on the key, update URL and the native
 * fingerprint this bundle was built against.
 */
export interface OtaBuildConfig {
  /** True only when a public key and a valid update URL were configured. */
  enabled: boolean;
  disabledReason: string;
  /** PKCS#1 PEM of the RSA-2048 public key. Empty when disabled. */
  publicKey: string;
  /** e.g. https://host/mobile-updates/bundles (no trailing slash). */
  baseUrl: string;
  /** Local verification builds only; see scripts/ota/ota-config.mjs. */
  allowInsecureHttp: boolean;
  /** Fingerprint of the native layer this bundle was built for ("" if unknown). */
  nativeFingerprint: string;
}

declare const __ERVE_OTA_BUILD__: OtaBuildConfig | undefined;

export const DISABLED_BUILD_CONFIG: OtaBuildConfig = {
  enabled: false,
  disabledReason: 'OTA build constants were not injected',
  publicKey: '',
  baseUrl: '',
  allowInsecureHttp: false,
  nativeFingerprint: '',
};

export const otaBuildConfig: OtaBuildConfig =
  typeof __ERVE_OTA_BUILD__ === 'undefined' ? DISABLED_BUILD_CONFIG : __ERVE_OTA_BUILD__;
