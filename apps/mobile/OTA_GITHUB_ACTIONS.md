# GitHub Actions OTA releases — Erve mobile

The workflow `.github/workflows/release-mobile-ota.yml` builds and publishes
React/web-only OTA updates for the **existing Capacitor APK**. No local release
workstation is needed for day-to-day updates, and no APK reinstall is needed
when the installed app's native fingerprint still matches.

## One-time setup

1. **Generate one OTA RSA key pair** using
   `pnpm --filter @erve/mobile ota:keygen -- --private-out <path-outside-repo>`.
   This can be done once on a trusted machine. It is **not** a repeat task for
   every update. Keep an offline encrypted backup of the private PEM.
2. Commit **only** `apps/mobile/ota/ota-public-key.pem` on a feature branch
   and merge it to `main`. APKs built after that include the public key.
3. Go to **GitHub → Settings → Environments → production → Environment
   secrets**. Add exactly one new secret:
   `ERVE_OTA_PRIVATE_KEY_PEM` = **the full private PEM text**, including
   BEGIN/END lines. Never put this value in a repository file, chat, log,
   artifact, or workflow input.
4. The existing `production` deployment environment must already provide:
   `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` secrets and
   `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_USER`, `DEPLOY_ROOT` variables.
   The workflow reuses these; it does **not** ask for another SSH key.
5. Repository Actions variables `ERVE_ANDROID_API_URL` (HTTPS URL ending
   `/api`) and `ERVE_OTA_BASE_URL` (HTTPS URL ending
   `/mobile-updates/bundles`) must be set, exactly as for the APK workflow.
6. The server must serve `<DEPLOY_ROOT>/shared/mobile-updates/bundles/`
   at `ERVE_OTA_BASE_URL` with the OTA Nginx route from the existing runbook.
   If the remote folder or HTTPS route does not exist, the first workflow run
   fails; creating that folder and enabling the Nginx route is one-time
   hosting setup.

The Android APK and OTA key pairs are **different**. The existing Android
keystore secrets are not involved in OTA releases.

## Release a normal web update

1. Merge the React changes to `main` and let the usual CI finish.
2. Go to **Actions → Release Erve mobile OTA update → Run workflow**,
   branch **main**, operation **publish-testing**.
3. When complete, the Actions log prints the new testing build number.
   Open the app on your **testing-channel APK**, check for updates and confirm
   the changed screen works.
4. Run the workflow again with **promote-production**, enter that testing
   build number, and tick **confirm_production**.
   Production gets the **same tested bundle**, not a rebuild.

## Roll back a broken production update

Select **rollback-production**, enter the **previous working production
build number**, a short reason, and tick **confirm_production**. The
existing OTA tooling reissues those bytes as a newer build. It does not
roll Android's versionCode backwards.

If more than one APK native generation is in use, the optional
`fingerprint` input targets a specific generation. Leave it blank for
the current APK generation.

## What GitHub does on every run

- Accept only a **manual dispatch from main** whose exact commit passed CI.
- Reuse the existing GitHub `production` environment for signing and SSH.
- Pull the latest signed OTA manifest/history from the existing server.
- Build the mobile web bundle **only for publish-testing**.
- Sign the update, verify it, synchronize it over SSH, and check the HTTPS
  channel endpoint.
- Remove the temporary private-key files when the job ends.

No APK is generated or distributed by this workflow. No API/database
deployment happens. GitHub runners are temporary; the **server's signed OTA
history** remains the source of truth. The workflow does not trigger
automatically on every push.
