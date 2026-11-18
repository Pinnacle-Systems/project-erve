# Over-the-air (OTA) updates for the Android app

The packaged Android app is distributed as an APK, not through Google Play. This
document describes how the web part of the app (React, HTML, CSS, JavaScript) is
updated on devices **without reinstalling the APK**, and what still needs a new
APK.

This is not a PWA and the app never loads the ERP web portal: every OTA bundle
is the same Vite build of `apps/mobile` that is embedded in the APK, delivered as
a signed zip and served by Capacitor from device storage.

## Architecture

```
          ┌──────────── release workstation (holds the PRIVATE key) ────────────┐
 apps/mobile ─► pnpm build ─► dist/                                              │
          │   ota:publish  ─► TESTING  channel   (sealed + signed)               │
          │   ota:promote  ─► PRODUCTION channel (same bytes, explicit, by hand) │
          │   ota:rollback ─► re-release an earlier build under a NEW, higher    │
          │                   build number and manifest sequence                 │
          └───────────────────────────────┬──────────────────────────────────────┘
                                          │ ota:sync  (bundles → history → manifest last)
                                          ▼
   <DEPLOY_ROOT>/shared/mobile-updates/bundles/        (static files via nginx; no key, no code)
        <testing|production>/manifest.json                  signed, mutable, no-cache
        <testing|production>/history.json                   signed audit log, mutable, no-cache
        <testing|production>/<native-fingerprint>/<n>.bundle   immutable, cached 1 year
                                          ▲
                                          │ HTTPS GET (native HTTP client)
 ┌───────────── APK on device ────────────┴──────────────────────────────┐
 │ src/ota/ (OtaUpdateService)   decides: check, download, when           │
 │ @capgo/capacitor-updater      native: download, verify, store,         │
 │   (manual mode, self-hosted)  switch, roll back                        │
 │ embedded web bundle           always present, always bootable          │
 │ channel + native fingerprint  read from the APK, never from the bundle │
 └────────────────────────────────────────────────────────────────────────┘
```

**Library:** [`@capgo/capacitor-updater`](https://github.com/Cap-go/capacitor-updater)
8.54.2 (MPL-2.0, peer dependency `@capacitor/core ^8`, matching this app's
Capacitor 8). It is used purely as a self-hosted engine in manual mode
(`autoUpdate: false`). Its cloud endpoints are disabled (`updateUrl`,
`statsUrl`, `channelUrl` are empty), so nothing is ever sent to Capgo. All
policy lives in `apps/mobile/src/ota/`.

| Concern                             | Where                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Decisions, state machine            | `src/ota/ota-service.ts`                                                                                                             |
| Signed-manifest verification        | `src/ota/manifest.ts`, `src/ota/rsa.ts` (WebCrypto)                                                                                  |
| "Is it safe to reload now?"         | `src/ota/update-guards.ts`, `src/ota/useUpdateSafetyGuards.ts`                                                                       |
| Lifecycle wiring, banner            | `src/ota/OtaProvider.tsx`; startup hook in `src/main.tsx`                                                                            |
| Account sheet "App updates" section | `src/ota/OtaStatusSection.tsx`                                                                                                       |
| Native updater config + fingerprint | `capacitor.config.ts`, `capacitor.base-config.mjs`, `scripts/ota/*.mjs`                                                              |
| Release tooling                     | `scripts/ota-release.mjs`, `scripts/ota/release-store.mjs`, `sync.mjs`, `verify-remote.mjs`; `ota-keygen.mjs`, `ota-fingerprint.mjs` |

No ERP page, route or API was changed. The guards observe the router, the query
client's mutation cache and the DOM; they do not alter what a page does.

## What an OTA update can and cannot change

| Change                                                                                 | Delivered by |
| -------------------------------------------------------------------------------------- | ------------ |
| React components, routes, hooks, TypeScript/JavaScript, HTML, CSS, images in `public/` | OTA          |
| JavaScript dependencies (React, TanStack Query, axios, `@erve/*` workspace packages…)  | OTA          |
| Anything under `native/android-template/` (Java bridge plugins, themes, icons, splash) | **new APK**  |
| Adding, removing or upgrading a Capacitor/Cordova plugin (`@capacitor/*`, `@capgo/*`)  | **new APK**  |
| `@capacitor/core` / `@capacitor/android` version, Gradle/SDK versions                  | **new APK**  |
| Android permissions or manifest entries (they come from plugins or the template)       | **new APK**  |
| Capacitor config: app id, plugin settings, **OTA public key**, `httpsOnly`             | **new APK**  |
| Manually forced via `native/NATIVE_EPOCH` (see below)                                  | **new APK**  |

## Native compatibility rule

Compatibility is a hash comparison, not a convention anyone has to remember.

`scripts/ota/native-fingerprint.mjs` hashes everything that defines the native
layer — template files (line-ending normalised, `*.test.ts` excluded), the
installed version of every native-affecting dependency, the effective Capacitor
config and `native/NATIVE_EPOCH`. The result (128-bit hex) is:

- written into the APK as the updater plugin's builtin `version`
  (`<app version>-erve-native.<fingerprint>.<channel>`), which the app reads on
  device. The channel (`testing` or `production`) is deliberately **not** part of
  the fingerprint, so a testing APK and a production APK built from the same
  sources are the same native layer and can run the very same OTA bundle bytes;
- compiled into every web build and recorded in `dist/ota-build-info.json`;
- the directory name of that build's releases on the server (per channel).

A bundle is installed **only if its fingerprint equals the device's**. This is
enforced three times: the publisher refuses to publish a `dist/` built for a
different fingerprint; the app only looks up the release filed under its own
fingerprint; and at every startup a bundle whose compiled-in fingerprint differs
from the device's is thrown away (this is what protects an APK that was
side-loaded over an older one — see Limitations for why we do not rely on the
plugin's version-based reset).

`pnpm --filter @erve/mobile ota:fingerprint -- --explain` lists every input,
which is the quickest way to see why a change forces a new APK.

Use `native/NATIVE_EPOCH` (a one-line integer file; absent means `0`) as the
escape hatch when a native change is made somewhere the hash cannot see — for
example a hand-edit of the generated, git-ignored `android/` project. Bump it,
and every web build is then treated as incompatible with previously installed
APKs.

Several APK generations can coexist. The manifest holds one release per
fingerprint plus `latestNativeFingerprint`:

- A device on an **older** fingerprint keeps receiving web updates published
  for it, and sees a note that a newer app installation exists.
- If no release exists for the device's fingerprint (never published, or
  withdrawn with `ota:retire`) and a newer APK exists, the device is told a new
  APK must be installed and receives nothing further.

## First-time setup

1. **Generate the signing key pair** (once; keep the private key off the repo):

   ```sh
   pnpm --filter @erve/mobile ota:keygen -- --private-out "<safe path>/erve-ota-private.pem"
   ```

   It writes the public key to `apps/mobile/ota/ota-public-key.pem` — **commit
   that file** (`.gitignore` explicitly allows it despite the `*.pem` rule). The
   private key authorises what devices will install: store it like a deployment
   credential and back it up. Losing it, or rotating it, means shipping a new
   APK (the public key is part of the native config). The full production
   procedure — generation, storage, backup, access, rotation — is in
   [`OTA_RELEASE_RUNBOOK.md`](OTA_RELEASE_RUNBOOK.md).

2. **Choose the update URL.** Set `ERVE_OTA_BASE_URL`
   (`https://<DOMAIN_NAME>/mobile-updates/bundles`) for APK builds. If it is
   unset and `VITE_API_URL` is an https URL ending `/api`, it is derived from
   that. `ERVE_OTA_CHANNEL` (`production` — the default — or `testing`) selects
   which channel **this APK** follows; it is baked into the APK's native version
   only, never into the web bundle.

3. **Server.** The nginx route and directory already exist
   (`deployment/nginx/erve.vhost.example.conf` §3,
   `$DEPLOY_ROOT/shared/mobile-updates/bundles/`). Update the vhost with the two
   OTA `location` blocks (`no-cache` for metadata, `immutable` for bundles) and
   reload nginx.

4. **Build the APK** with the same environment, then install it once:

   ```sh
   export ERVE_OTA_BASE_URL=https://<DOMAIN_NAME>/mobile-updates/bundles
   pnpm --filter @erve/mobile build
   pnpm --filter @erve/mobile cap:sync
   cd apps/mobile/android && ./gradlew.bat assembleDebug   # JDK 21
   ```

   Without a public key or URL the build still works, but OTA is **disabled and
   fail-closed**: the app runs its embedded bundle and never contacts any update
   server. `ota:fingerprint` prints whether OTA is enabled and why not.

   APKs built before this feature contain no updater and must be replaced once.

## Publishing an OTA update

Releases move through two channels and nothing reaches production by accident:

```
build ──► ota:publish ──► TESTING ──(testers verify)──► ota:promote ──► PRODUCTION
                                                    └─► ota:rollback (either channel)
```

- `ota:publish` can only target **testing**; the library refuses production.
- `ota:promote --build <n>` copies the exact tested bundle (same bytes, checksum
  and signature material) into production under a new production build number.
  The tested build must be named explicitly and must still be the live testing
  build; builds made from uncommitted changes are refused.
- `ota:rollback --to-build <n> --reason "…"` re-releases the bytes of an
  earlier build of the same channel under a **new, higher** build number and
  manifest sequence. Devices only ever move forward, so a rollback is a forward
  release that carries old content.
- Every action is recorded in a signed per-channel `history.json`.
- Nothing publishes on push to `main`; no workflow runs these commands
  (enforced by `scripts/ota/release-policy.test.ts`).

Commands, examples, the promotion checklist, emergency rollback and key
handling are in **[`OTA_RELEASE_RUNBOOK.md`](OTA_RELEASE_RUNBOOK.md)**.

## What happens on a device

| Moment                 | Behaviour                                                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cold start / page load | Before React renders: verify this bundle matches the native layer; record any rollback; if a bundle is already staged **and nothing objects**, activate it (nothing in memory to lose). Never blocks launch (4 s budget). |
| After first render     | `notifyAppReady()` tells the updater this bundle is healthy; then check for updates (throttled to 1/min).                                                                                                                 |
| Return to foreground   | Apply a staged update if safe; otherwise check for a newer one (throttled to 1 / 5 min).                                                                                                                                  |
| Account sheet          | Shows the running version and last check result; "Check for updates" always runs.                                                                                                                                         |
| Update found           | Downloaded over HTTPS and verified natively, then **staged only** — it is never activated by the download itself.                                                                                                         |
| Staged update, unsafe  | Passive banner: "It will install when you finish your current task." No button.                                                                                                                                           |
| Staged update, safe    | Banner with "Restart now"; also applied automatically on the next cold start or resume.                                                                                                                                   |

### Never interrupting work

Activation reloads the WebView, so it is refused while **any** of these holds
(`update-guards.ts`, evaluated at the moment of the decision, not cached):

- the route is an open QA inspection (`/qa/:id`), quality execution
  (`/quality-executions/:id`), production task (`/factory-tasks/:id`) or job
  order (`/job-orders/:id`);
- any save is in flight, from two independent sources: the query client's
  mutation cache (stage updates, QA submissions, prepared quantities), and an
  HTTP-level tracker on the shared API client (`inflight-writes.ts`) that counts
  every POST/PUT/PATCH/DELETE on the wire — needed because QA evidence photos and
  quality attachments are sent with direct client calls that never appear in the
  mutation cache. Both are bounded (10 minutes) so a request whose connection
  died silently cannot hold updates until the app is restarted;
- a form field has been edited and is still on screen (released automatically
  when the form unmounts or the user navigates).

A guard that throws is treated as "unsafe". If another screen should be
protected, add its route to `PROTECTED_ROUTE_PATTERNS`.

### Sessions and local data survive updates

A bundle switch keeps the WebView origin (`https://localhost`), so `localStorage`
(including QA form drafts under `erve:qa-form-drafts:*`), `sessionStorage` (the
access token) and IndexedDB are untouched. The refresh credential lives in the
Android Keystore-backed `SecureSessionBridge` plugin, which the updater never
touches. Verified on device: see Verification.

### Failure handling

| Situation                                                             | Result                                                                                                                                                                                                     |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Offline                                                               | "No internet connection." in the Account sheet; no banner, no retry storm; embedded/installed bundle keeps running.                                                                                        |
| Server down / 5xx / unreachable                                       | "Can't reach the update server" / "returned an error (503)"; retried at the next launch/resume.                                                                                                            |
| No manifest yet (404)                                                 | Treated as "no updates published".                                                                                                                                                                         |
| Manifest forged, tampered, wrong channel, older than one already seen | Rejected before anything is downloaded.                                                                                                                                                                    |
| Bundle corrupt or not signed by our key                               | Rejected natively (checksum / session key); nothing is stored; backs off after 3 failed attempts for 6 h.                                                                                                  |
| New bundle crashes or never becomes ready                             | The updater reverts to the previous good bundle (or the embedded one) after ≈ 2 × `appReadyTimeout` (10 s → ≈ 20 s worst case). The build is recorded as failed, never retried, and the user is told once. |
| `set()` itself fails                                                  | Build marked failed, bundle deleted, user told.                                                                                                                                                            |

The embedded bundle is part of every APK (`android/app/src/main/assets/public`)
and is what the app falls back to; the app launches with no network at all.

## Security model

- **Transport:** HTTPS only (`httpsOnly: true` natively; the app also requires
  https and the update server's origin for every URL). Plain http exists only
  for local verification builds (`ERVE_OTA_ALLOW_INSECURE_HTTP=1`); that flag is
  part of the native config, so such an APK has a different fingerprint and can
  never receive a production bundle.
- **Bundle authenticity + integrity (native):** with the public key configured,
  `@capgo/capacitor-updater` stores a bundle only if its AES session key and
  SHA-256 checksum were produced with the matching **private** key (format
  implemented in `scripts/ota/bundle-crypto.mjs`, verified in the plugin's
  `CryptoCipher.java`). A compromised web host, CDN or network cannot produce an
  installable bundle. This provides authenticity, not secrecy — never put
  secrets in a bundle.
- **Manifest authenticity (app):** the manifest is RSASSA-PKCS1-v1_5/SHA-256
  signed; it is verified before any field is trusted. It carries a monotonically
  increasing `sequence` (manifest replay) and per-fingerprint monotonically
  increasing `buildNumber` (bundle downgrade).
- **Channels:** a device follows the channel its APK was built for (`testing` or
  `production`), read from the APK's native version — not from the web bundle,
  which an OTA update could replace. A manifest whose signed `channel` differs
  from the device's is rejected, so a testing manifest can never steer a
  production device even if it is served from the production URL.
- **Rollback is signed, forward-only:** rolling back signs a new manifest with a
  higher `sequence` pointing at old content under a higher `buildNumber`. The
  anti-replay and anti-downgrade rules therefore keep working unchanged, and an
  attacker cannot use them to push a device back to a vulnerable build.
- **Release history** is signed (`history.json`); `ota:verify` detects a
  tampered or stale (rolled-back) manifest next to a newer history.
- **No secrets in the frontend:** the web build embeds only the public key and
  the update URL. The private key is read from a file outside the repository by
  the release tooling only; publishing refuses a `dist/` containing private key
  material.
- One key pair serves both layers. They sign structurally different data (raw
  16/32-byte values vs. a DER-wrapped SHA-256 digest) that the verifiers reject
  for each other.
- The updater runs in manual mode with its Capgo cloud endpoints blanked: no
  telemetry, no channel switching, no preview/shake menu.

## Verification procedure (device)

Requires an emulator/device, `adb`, JDK 21 for Gradle, and a test HTTPS server.
For a throwaway local setup: create a test CA + `localhost` certificate, build
the **debug** APK with a debug-only `res/xml/network_security_config.xml`
(`<debug-overrides>` trusting the test CA) in the generated `android/app/src/debug/`
source set — never in `native/android-template/` — run a static HTTPS server
over the release tree, `adb reverse tcp:8443 tcp:8443`, and drive the WebView
through `adb forward … localabstract:webview_devtools_remote_<pid>`.

Scenarios to run against a packaged APK (all were exercised on an Android
emulator with the production `httpsOnly` configuration):

1. Cold start with no connectivity → embedded bundle renders; check reports offline.
2. Publish → app stages (does not activate) → kill + relaunch → new bundle active, status `success`.
3. Same, while logged in with planted `localStorage` / `sessionStorage` / secure-bridge values → all survive, still signed in.
4. Staged update + open `/qa/:id` + background/resume → not applied; leave the screen + resume → applied.
5. Server 503 / unreachable / airplane mode → clear status text, app unaffected.
6. Bundle that throws on startup → reverted to the previous bundle, build never retried, user told once.
7. Corrupted bundle behind a valid manifest; manifest signed by another key → both rejected.
8. Release for another native fingerprint → ignored; "newer app installation" note; after `ota:retire` → "new app must be installed".
9. Testing vs production channel, promotion of the tested bytes, and an emergency rollback (higher build + sequence) — covered over real HTTPS by `scripts/ota/ota-https.integration.test.ts`; see the runbook for the device checks.

## Limitations / operational notes

Outstanding issues found during release-candidate verification — a lost refresh
response revoking the session, silent QA evidence-upload failures, untested Final QA
and camera on physical devices, the unidentified production APK signing certificate,
and guard expiry versus unresolved writes — are recorded in
[OTA_KNOWN_ISSUES.md](./OTA_KNOWN_ISSUES.md).

- **First install:** existing APKs have no updater; replace them once.
- **Key rotation or loss** requires a new APK; there is no remote key revocation.
- **Bundle size:** a full zip (~0.5 MB today) is downloaded per update; no delta
  updates.
- **Every APK needs a higher version** (`package.json` `version` → Android
  `versionName`/`versionCode`, see the runbook §2). The plugin discards downloaded
  bundles when `versionCode` changes; the startup fingerprint check is the second
  line of defence if a same-code APK is ever side-loaded.
- **Stalled downloads fail slowly:** a download whose connection dies without a
  reset (network drop mid-transfer) is abandoned by the service's 5-minute
  timeout; the Account sheet shows "Downloading…" until then. Nothing partial is
  ever staged.
- **Resume checks are rate-limited** (5 minutes; launch 1 minute). "Check for
  updates" in the Account sheet bypasses the limit.
- **Dead screen window:** a bundle that fails before React renders leaves a
  blank screen until the native rollback fires (≈ 20 s). The testing channel
  exists to catch exactly this before production: promote only a build that a
  tester device has installed and confirmed.
- **Rolling back to the embedded bundle** is done by re-releasing the bundle
  that was built into the APK (publish it from that commit to testing, test,
  promote); devices cannot be told to "reset to embedded" remotely.
- **Testers need a testing-channel APK** (`ERVE_OTA_CHANNEL=testing` at build
  time). It is the same native layer as production, so the bytes they test are
  the bytes production receives, but it is a separate APK file.
- **Added permissions:** the updater plugin's dependencies add `WAKE_LOCK`,
  `ACCESS_NETWORK_STATE`, `RECEIVE_BOOT_COMPLETED` and `FOREGROUND_SERVICE` to
  the merged manifest.
- **Protected-route list** is explicit; a new operational screen is not guarded
  until its route is added.
- iOS is not configured (the project ships Android only).
