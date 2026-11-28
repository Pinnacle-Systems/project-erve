# Erve India — one Android APK (GitHub Actions)

The manual workflow **Build signed Erve Android APK** builds **one APK**
with the **production** OTA channel. There is no channel selector and no
separate testing APK.

## Build and install

1. Open **GitHub → Actions → Build signed Erve Android APK → Run workflow**;
   select **main**.
2. After the run succeeds, download the **erve-android-...** artifact and
   extract the signed APK.
3. Install it on your own Android phone and check login and core QA/factory
   workflows. Then distribute **the same APK** to the users.

The build uses existing `android-release` Environment signing secrets and
the repository's `ERVE_ANDROID_API_URL` and `ERVE_OTA_BASE_URL` HTTPS variables.
The committed `apps/mobile/ota/ota-public-key.pem` is embedded in the APK.
The workflow **does not** deploy to the server or publish a GitHub Release.

For a new APK that upgrades an installed APK, increase
`apps/mobile/package.json` version so Android's derived `versionCode` is
higher than the previous APK. Keep the same Android signing certificate.
The signing environment's `ERVE_ANDROID_LAST_PRODUCTION_VERSION_CODE` should
match the highest distributed code (0 for the very first release).

**Web/UI-only changes do not need another APK.** Use the separate manual
**Release Erve mobile OTA update** workflow to publish to all installed apps;
see [OTA_GITHUB_ACTIONS.md](OTA_GITHUB_ACTIONS.md). Keep the OTA private key
separate from the Android APK keystore.
