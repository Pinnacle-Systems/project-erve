# GitHub Actions: signed Erve Android APKs

The new workflow **Build signed Erve Android APK** is a manually dispatched APK build, not an OTA publisher or VPS deployment. Its source must be the reviewed main branch, and its exact commit must have passed main push CI. The signing job uses the GitHub Environment named **android-release**.

The workflow produces a signed APK and checksum, stored as a GitHub Actions artifact for **14 days**. Nothing is automatically installed, distributed, published to GitHub Releases, or sent to the production server.

## 1. Decide the existing Android signing identity

**Before setting any GitHub secrets**, locate the APK used in early testing if it was installed or distributed. Read its certificate and versionCode:

~~~sh
pnpm --filter @erve/mobile apk:cert -- /absolute/path/to/previous.apk
~~~

Compare the returned signer SHA-256 with your original Android signing keystore using:

~~~sh
keytool -list -v -keystore /secure/location/erve-release.jks -alias YOUR_ALIAS
~~~

If an older APK needs to be upgraded without uninstalling, **reuse the exact signing identity**. If the old APK was debug-signed or its key is lost and no important app data needs preserving, explicitly accept a **one-time uninstall/reinstall** on those test devices and create a permanent release keystore. Uninstall deletes app data, including stored login. Do not assume a new key will upgrade an old APK.

Keep the Android .jks file and passwords in at least two separately stored encrypted backups. GitHub Secrets must **not** be the only copies.

The Android keystore is distinct from the **OTA private signing key**. The APK workflow does not need, read or store the OTA private key. Generate the OTA key following [OTA_RELEASE_RUNBOOK.md](OTA_RELEASE_RUNBOOK.md), keep the private half offline, and commit **only** apps/mobile/ota/ota-public-key.pem in a separately reviewed change.

## 2. Configure the GitHub release environment

Open repository **Settings → Environments**. Create **android-release**.

For this public repository, enable required reviewers, restrict environment deployments to **main**, and enable **Prevent self-review** when an authorized second person is available. Protect changes to the main branch and workflow files through repository rules/review. An environment name alone does not configure these protections.

Add these **Environment secrets**:

| Name | Value |
| --- | --- |
| ANDROID_KEYSTORE_BASE64 | Base64 of the original release .jks bytes |
| ANDROID_KEYSTORE_PASSWORD | Keystore password |
| ANDROID_KEY_ALIAS | Keystore alias |
| ANDROID_KEY_PASSWORD | Key password |

On an authorized Windows workstation, this produces base64 on the clipboard without printing it to the terminal:

~~~powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\secure-location\erve-release.jks')) | Set-Clipboard
# Paste directly into the GitHub secret field. Clear clipboard afterward.
Set-Clipboard -Value ''
~~~

Base64 is **not encryption**. Do not paste any keystore/password/private key into Git, chats, issue comments, logs or untrusted terminals.

Add these **Environment variables** (public/non-secret):

| Name | Value |
| --- | --- |
| ANDROID_SIGNER_SHA256 | Expected 64-character SHA-256 of the Android signing certificate |
| ERVE_OTA_BASE_URL | https://YOUR_HOST/mobile-updates/bundles |
| VITE_API_URL | The actual HTTPS API base URL the Erve mobile app should use |

Verify the API URL with the project configuration rather than guessing its path. Both APK channels use the configured API endpoint; **testing OTA** does not mean **testing ERP backend**. Run field data tests using authorized accounts and safe test data. Changing the API endpoint between the testing and production bundles may invalidate byte-identical OTA promotion assumptions.

This workflow **fails closed** when the committed OTA public key, variables or signing secrets are missing. Do not bypass its gates to get a production APK.

## 3. Build a testing APK

1. Merge the reviewed OTA public-key commit into main. Wait until its **main push CI** passes.
2. Check apps/mobile/package.json version: the resulting Android versionCode must exceed the highest code distributed before. For example, 0.1.0 maps to 100, 0.1.1 to 101. Update the version in a reviewed commit if necessary.
3. Open **Actions → Build signed Erve Android APK → Run workflow**, select **main**, OTA channel **testing**, and enter **previous_version_code** (the highest versionCode already distributed; 0 only for a genuinely first signed release identity).
4. Have the authorized reviewer approve the **android-release** environment job.
5. When it succeeds, download artifact erve-android-testing-RUN_NUMBER, containing the APK and .sha256 file. Retention: **14 days**.
6. Install on a dedicated Android test phone. Verify login, secure session restoration, camera/evidence capture, QA/production form guards, OTA staging on testing, rollback and upgrades. Follow the physical-device acceptance in OTA_RELEASE_RUNBOOK.md §4.1.

The workflow verifies the signing certificate against ANDROID_SIGNER_SHA256, checks the OTA public key and channel embedded in the APK, rejects debug signing/test CA/unsafe URLs, and requires a higher versionCode than the **manually entered** previous value. Keep an accurate record of every released version; the workflow cannot discover all APKs distributed outside GitHub.

## 4. Build a production APK and archive it

After device acceptance and deliberate release approval, manually run the same workflow from main, with channel **production**. Reuse the same permanent Android signing identity. Do not interchange the testing and production APKs on a single device (both use com.erve.mobile).

Artifacts are temporary, so retain an approved production APK, checksum, certificate fingerprint, app version and source SHA in a long-term owner-controlled location. **GitHub Releases are publicly downloadable in this public repository.** Use them only if publicly sharing the APK is acceptable, and manually publish the approved asset. Otherwise use restricted storage.

No action in this pipeline publishes to GitHub Releases or to the production VPS. OTA web-bundle publishing remains a separate controlled procedure in OTA_RELEASE_RUNBOOK.md.

## 5. Safety and troubleshooting

- **No previous APK:** before the very first permanent release, verify the new signing certificate and record it. Set previous_version_code=0 only if no prior permanent identity must be preserved.
- **Incorrect signer/alias:** verify keytool fingerprints and GitHub Environment variables; do not bypass apk:check.
- **Test CA or local update URL in APK:** fail the release and rebuild from the approved code/configuration.
- **No public OTA key:** generate/back up the OTA key offline, then commit only its public half to main.
- **CI not green:** fix or complete exact-commit main CI; this workflow does not sign arbitrary branches or PRs.
- **Lost keystore:** use offline backup; changing identity requires a separate migration decision and may force reinstall.
- **Publishing approved APKs:** GitHub Releases make assets public; never upload private signing material.
