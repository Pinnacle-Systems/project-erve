import type { CapacitorConfig } from '@capacitor/cli';
import baseConfig from './capacitor.base-config.mjs';
import { loadOtaBuildConfig, resolveNativeIdentity } from './scripts/ota/ota-config.mjs';

// Over-the-air updates (see OTA_UPDATES.md). The native updater runs in manual
// mode; its config — including the public key bundles must be signed for and
// the native fingerprint reported as the plugin's builtin `version` — is
// derived here so the APK and the web bundle can never disagree.
const ota = loadOtaBuildConfig();
const { config, builtinVersion } = resolveNativeIdentity({ baseConfig, ota });

const capacitorConfig: CapacitorConfig = {
  ...config,
  plugins: {
    ...config.plugins,
    CapacitorUpdater: { ...config.plugins.CapacitorUpdater, version: builtinVersion },
  },
};

export default capacitorConfig;
