# Erve India — OTA updates through GitHub Actions

Erve has **one Android APK** and **one active OTA channel: production**.
Web/UI updates are published from GitHub Actions and become available to
**all installed apps** when they check for updates. No testing APK and no
testing-to-production promotion.

## One-time setup

- The OTA public key is already committed at
  `apps/mobile/ota/ota-public-key.pem`.
- The `production` GitHub Environment secret
  `ERVE_OTA_PRIVATE_KEY_PEM` holds the matching private PEM. Back up the
  private key offline; never commit it.
- The workflow reuses `production` Environment secrets
  `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS`, Environment variables
  `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_USER`, `DEPLOY_ROOT`, and
  repository variables `ERVE_ANDROID_API_URL` and `ERVE_OTA_BASE_URL`.
- The server must serve
  `<DEPLOY_ROOT>/shared/mobile-updates/bundles/` over HTTPS at
  `ERVE_OTA_BASE_URL`.

## Publish an update to everyone

1. Merge the web app changes to `main`.
2. Open **Actions → Release Erve mobile OTA update → Run workflow**.
3. Choose operation **publish-production** and branch **main**.
4. After the workflow succeeds, open the installed app on your phone and
   confirm the update is received and the changed feature works.

The update is available to everyone when published. There is **no staging
or separate approval operation**. The workflow signs the bundle using the
OTA private key, copies the bundles and signed manifest to the existing
server, and verifies the HTTPS endpoint.

## Rollback

Choose **rollback-production**, enter the **previous good production build
number** shown in OTA release history and a reason, then run the workflow.
The old version is republished as a new update so installed apps can
receive it. No APK reinstall is needed for a web-only rollback.

The OTA workflow is manual; it does not change server API code, database
contents, or Android native code. Changes to native code/plugins or the
OTA signing public key still require a new APK.
