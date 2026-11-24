# Erve India — GitHub Actions Android APK release pipeline

**Status:** Workflow implementation is in `.github/workflows/build-android-apk.yml`.
It can only be started manually, from `main`, **after** this workflow is
merged to the default branch. Nothing here deploys the API, publishes OTA
bundles, uploads an APK to a public GitHub Release, or installs an APK on a
device.

This is an alternative to the **APK signing workstation** procedure in
[`OTA_RELEASE_RUNBOOK.md`](OTA_RELEASE_RUNBOOK.md) §2.
It does **not** replace the OTA private-key custody/publishing process.

## A. Decisions to make once, before configuring GitHub

1. **Identify any APK already installed by users.** Obtain that APK and run
   `pnpm --filter @erve/mobile apk:cert -- <distributed.apk>` (or
   `apksigner verify --print-certs <distributed.apk>`). Record its
   signing-certificate SHA-256 and Android `versionCode`.
2. **Decide whether the initial testing APK must be upgraded in place.**
   An Android update requires the same signing identity and a strictly higher
   `versionCode`. If the old test APK was debug-signed or the key is lost,
   you must either recover the original key or accept a one-time uninstall
   and reinstall **on those test devices** (local data/login will be lost).
   Never quietly replace an existing production signing identity.
3. **Keep one permanent Android release keystore** (`.jks` or `.keystore`)
   outside source control. Keep two encrypted/offline backups, separated from
   the passwords. Keep a copy of the signer SHA-256 in release records.
4. **Generate the *different* OTA signing key pair** using the approved
   `ota:keygen` procedure in `OTA_RELEASE_RUNBOOK.md` §1; commit **only**
   `apps/mobile/ota/ota-public-key.pem`. The OTA private key stays with
   authorized release managers, outside the repo and outside this workflow.
5. Confirm the **HTTPS API URL** and **HTTPS OTA bundle URL**. Nginx OTA routes
   and the first OTA publish are separate tasks; a signed APK is not evidence
   that the OTA host is ready.

## B. GitHub configuration — owner-only

This repository is public. Do not add private-key files to git or upload an
unencrypted keystore to an issue, PR, chat or a workflow artifact.

**Repository → Settings → Secrets and variables → Actions → Variables**
(create repository *variables*, not secrets):

| Variable | Example / rule |
| --- | --- |
| `ERVE_ANDROID_API_URL` | `https://example.com/api`; real HTTPS API endpoint |
| `ERVE_OTA_BASE_URL` | `https://example.com/mobile-updates/bundles`; real HTTPS OTA endpoint |
| `ERVE_ANDROID_VERSION_CODE` | Optional override; normally leave unset and use `apps/mobile/package.json` version |

**Repository → Settings → Environments → New environment**:
create `android-apk-signing`. Restrict deployment branches to **`main`**,
and add **required reviewers**. If there are at least two authorized maintainers,
enable prevention of self-review. The job cannot access protected secrets until
an authorized reviewer approves. Do not use ordinary PR or repository secrets
as a substitute for the protected environment.

In `android-apk-signing`, add these *environment variables*:

| Variable | Meaning |
| --- | --- |
| `ANDROID_APK_SIGNING_READY` | Exactly `enabled` after the environment protections are configured |
| `ANDROID_EXPECTED_SIGNER_SHA256` | Approved release-certificate SHA-256 (64 hex digits; colons accepted) |
| `ERVE_ANDROID_LAST_TESTING_VERSION_CODE` | Highest `versionCode` **already distributed to testing devices**; `0` for a first release |
| `ERVE_ANDROID_LAST_PRODUCTION_VERSION_CODE` | Highest `versionCode` **already distributed to production users**; `0` for a first release |

Update the appropriate last-distributed versionCode **after you actually
distribute an APK**. The workflow fails if the candidate versionCode is not
higher. A testing and production APK may use the same versionCode because their
last-distributed counters are separate; they are intended for **different
devices**, as both use `com.erve.mobile`.

Add these *environment secrets*:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64 of the **binary Android release keystore**, not its password |
| `ANDROID_KEYSTORE_PASSWORD` | Password opening the Android release keystore |
| `ANDROID_KEY_ALIAS` | Alias for the release key inside the keystore |
| `ANDROID_KEY_PASSWORD` | Password for that private key (may equal keystore password) |

In **PowerShell on the owner's workstation**, obtain the Base64 value to
paste *directly* into the environment secret's value box:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\secure\erve-release.jks'))
```

Do not paste the output into chat, terminal logs, GitHub issues or any file
inside the repository. GitHub secrets encrypt the value, but Base64 by itself
is **not encryption**. If the encoded keystore exceeds GitHub's per-secret
limit, use a separately reviewed solution; do not split the private key across
unprotected variables.

## C. First run (after this PR is merged)

1. Merge the reviewed workflow. GitHub requires a `workflow_dispatch`
   workflow to exist on the default branch before it appears in the manual
   Actions interface.
2. Set the repository URLs, the protected environment, its variables and
   its secrets as described above. Keep the keystore's encrypted backup.
3. Commit the OTA **public** key in a separate reviewed PR. There is currently
   no OTA production public key; until one is committed, this workflow
   intentionally fails rather than producing an OTA-disabled distribution APK.
4. Raise `apps/mobile/package.json` `version` to a value whose derived
   `versionCode` exceeds that of any APK being replaced (or set the approved
   override). For example, `0.1.1` derives `101`.
5. Open **Actions → Build signed Erve Android APK → Run workflow**,
   choose branch `main` and channel **testing**. For production, choose
   **production** and check the explicit confirmation box.
6. An authorized environment reviewer approves the signing job. The
   compilation/build job runs *before* access to signing secrets; the
   signing job downloads the unsigned APK from that same workflow run.
7. Download the resulting `erve-android-<channel>-<version>-<run-id>` ZIP
   from the **signed artifact** section. It contains the signed APK and
   its `.sha256` digest. The signed artifact is retained for **14 days**;
   the intermediate unsigned artifact for **1 day**.
8. Independently record the APK SHA-256, certificate SHA-256,
   `versionCode`, channel, commit SHA and device-test results. Archive
   approved production APKs in a separate controlled storage location.
   **No GitHub Release is created automatically.**

**Note:** A public repository's Actions artifacts are not a private app
distribution mechanism. If the APK itself must be access-controlled, store
approved APKs in a private distribution location instead of relying on
the Actions download URL.

## D. What the workflow enforces

- **Manual, main-only**, pinned-to-commit build; no PR secrets, no push-based
  signing, no automatic publishing or deployment.
- Builds the **existing React + Capacitor Android app** from a clean generated
  Android project on Ubuntu with Node 24, pnpm from the root lockfile and
  JDK 21.
- Requires a committed public OTA key, a public HTTPS OTA base URL and a public
  HTTPS API URL ending `/api`. Rejects missing/localhost/insecure config.
- Generates the Android version using the existing scripts.
- Aligns and signs the APK with the Android keystore restored **only inside
  the signing step**. Signing passwords are supplied to `apksigner` via
  environment variables, never command-line password values. Key files are
  removed at the end of the step, and hosted runners are ephemeral.
- Runs existing `apk:check` against the approved signer fingerprint,
  production-vs-testing channel, committed OTA public key, app identity,
  debugging flags, and test-certificate/network leftovers.
- Requires the candidate `versionCode` to be greater than the corresponding
  *manually recorded* last-distributed value. An incorrectly recorded value
  cannot substitute for checking an older physical APK when preparing a
  sideloaded upgrade.
- Uploads only the verified signed APK and SHA-256 to the final artifact.
  Neither the OTA private key nor the Android keystore enters the artifact.

## E. Testing and release acceptance

1. Install the **testing** signed APK on a designated physical Android device
   (over the existing APK only when signatures and versionCode are compatible).
2. Confirm successful login, secure session restoration, QA photos, Final QA,
   production entry, and background/resume. Existing open issues are documented
   in `OTA_KNOWN_ISSUES.md`.
3. Publish a tiny React text change to the **testing OTA channel** using the
   *separate* `OTA_RELEASE_RUNBOOK.md` workflow. Verify it downloads and
   activates **without reinstalling the APK**.
4. Verify unfinished QA/production edits are not interrupted, offline start
   works, and a bad bundle can be rolled back.
5. Build the **production-channel APK** from the intended `main` commit and
   validate it on a distinct device. Production must not see testing-only OTA
   releases.
6. Only after the owner approves the physical-device pilot should the
   production APK be distributed. Publishing OTA bundles and enabling the
   server's Nginx routes remain separate manual release steps.

## F. What this does *not* do

- Generate or rotate either signing key.
- Push any APK or OTA bundle to production, the VPS or GitHub Releases.
- Set up the VPS's OTA Nginx route or a release manager's SSH access.
- Handle OTA private-key operations in GitHub Actions.
- Cure the separate shared-auth refresh issue or silent QA evidence-upload
  error. Those require separate work before full field rollout.

For manual APK signing and exact native compatibility background, consult
`OTA_RELEASE_RUNBOOK.md` §§1–2.4.
