# OTA release runbook (self-hosted)

How to generate the signing key, publish a web update to **testing**, promote it
to **production**, and roll back in an emergency. Architecture and the security
model are in [`OTA_UPDATES.md`](OTA_UPDATES.md); this file is the procedure.

**Nothing in this repository publishes automatically.** No workflow runs these
commands, deployments never touch the release directory, and production only
receives a build through an explicit `ota:promote` (enforced by
`scripts/ota/release-policy.test.ts`).

## 0. Vocabulary

| Term                    | Meaning                                                                                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Release workstation** | The one trusted machine (Linux, macOS or WSL — `rsync` and `ssh` needed for remote sync) where the **private key** is available and release commands run. It is not the build server.        |
| **Release tree**        | A directory **outside the repository** that mirrors `<DEPLOY_ROOT>/shared/mobile-updates/bundles/`. All release commands operate on it. `ERVE_OTA_RELEASE_TREE` or `--tree`.                 |
| **Channel**             | `testing` or `production`. A device follows the channel its **APK** was built for. They are fully separate directories, manifests and histories.                                             |
| **Native fingerprint**  | Hash of everything native (see `OTA_UPDATES.md`). A bundle only installs on an APK with the same fingerprint. Testing and production APKs built from the same sources share one fingerprint. |
| **Build number**        | Per channel and fingerprint, strictly increasing. The OTA version is `<app version>-ota.<build number>`.                                                                                     |
| **Manifest sequence**   | Per channel, strictly increasing. Devices ignore any manifest with a lower sequence than one they have seen.                                                                                 |

Every command below is run from the repo root; `--` separates pnpm arguments.

```sh
export ERVE_OTA_RELEASE_TREE=$HOME/erve-ota-release-tree          # outside the repo
export ERVE_OTA_PRIVATE_KEY_FILE=/secure/path/erve-ota-private.pem # outside the repo, see §1
alias ota='pnpm --filter @erve/mobile'
```

## 1. Production signing key — one-time setup

> **Approval gate.** Generating the production key is a deliberate act by the
> project owner. Nobody should generate it on a shared, CI or build machine, and
> it must never be requested over chat or e-mail.

The key pair is RSA-2048. The **public** key is compiled into every APK and is
committed. The **private** key authorises what devices will install: whoever has
it can run code in every installed app. Treat it like the production database
credentials or stronger.

### 1.1 Generate (on the release workstation, offline preferred)

```sh
ota ota:keygen -- --private-out /secure/path/erve-ota-private.pem
```

- Writes the private key with mode `0600` and refuses to write inside the
  repository or to overwrite an existing key.
- Writes the public key to `apps/mobile/ota/ota-public-key.pem`.
- Prints only file paths — never key material.

Confirm the private key is not in the repo and is unreadable by others:

```sh
git status --short            # must list ONLY apps/mobile/ota/ota-public-key.pem
ls -l /secure/path/erve-ota-private.pem   # -rw------- (Windows: icacls <file> /inheritance:r /grant:r "%USERNAME%:R")
```

`.gitignore` already blocks `*.pem` and `*ota-private*`, with an explicit
exception for `apps/mobile/ota/ota-public-key.pem` only.

### 1.2 Commit only the public key

```sh
git add apps/mobile/ota/ota-public-key.pem   # review: it must say BEGIN RSA PUBLIC KEY
```

Do this in the PR that introduces OTA. **Every APK built from that commit on
trusts this key**; there is no remote revocation (§8).

### 1.3 Storage and backup (required before the first production release)

1. **Primary copy:** an encrypted volume or hardware-backed store on the release
   workstation (BitLocker/LUKS/FileVault volume, or a hardware token if you use
   one), readable only by the release manager's account.
2. **Two offline backups** in different physical places (e.g. an encrypted USB
   drive in a safe, and a sealed copy held by a second authorised person). Encrypt
   each before it leaves the workstation, with a passphrase kept **separately**
   from the file:

   ```sh
   gpg --symmetric --cipher-algo AES256 -o erve-ota-private.pem.gpg /secure/path/erve-ota-private.pem
   # or: age -p -o erve-ota-private.pem.age /secure/path/erve-ota-private.pem
   ```

3. **Passphrase** in the organisation's password manager, in a vault shared only
   with the people in §1.4. Never in the repository, a ticket, chat, CI variable
   or the same place as the encrypted file.
4. **Restore drill:** decrypt one backup to a temp directory, then check it is
   the pair of the committed public key (the release tooling does this on every
   run: `The private key does not match the OTA public key…`). Do it once now and
   after any key handling change.

### 1.4 Who may use it

Name at most two release managers. A third person holds the sealed backup. Keep
the list in the project's access register; remove access when someone leaves.

### 1.5 Making it available to release tooling — and what must never happen

- The tooling takes the key as a **file path** (`--private-key-file` or
  `ERVE_OTA_PRIVATE_KEY_FILE`) outside the repository. It refuses a path inside
  the repo, never prints the key, and there is no environment-variable form.
- Decrypt a backup only on the release workstation, into a `0600` file on an
  encrypted volume (or `tmpfs`/`/dev/shm`), and delete it when the session ends
  (`shred -u` where available).
- The key must **never** be: committed, put in `.env`, passed on a command line
  as text, echoed, written to logs or CI output, copied to the server, placed in
  `dist/`, in an APK, in a release tree, or in a deployment artifact. Release
  trees contain only signatures, never the key; `ota:publish` also refuses a
  `dist/` that contains private-key material.
- **CI is not a signing location in this design.** If the organisation later
  decides to sign in GitHub Actions, that is a separate, reviewed decision
  (protected environment with required reviewers, manual trigger only); it is not
  set up here and no secret has been requested.

## 2. APK builds and signing (once per native layer)

An APK follows one channel. Build both from the same commit. Every APK that is
distributed needs a **higher version than the one it replaces**:

1. Raise `version` in `apps/mobile/package.json` (e.g. `0.1.0` → `0.1.1`). It
   becomes the Android `versionName`, the app version shown in the Account sheet
   and the app version inside the OTA native version string. The Android
   `versionCode` is derived from it (`major*10000 + minor*100 + patch`, so
   `0.1.1` → `101`); set `ERVE_ANDROID_VERSION_CODE=<n>` to override the code
   only. Without a higher `versionCode` Android will not treat the file as an
   upgrade and the updater will not discard the old OTA bundle.
2. Build (the `cap:sync` script also applies the version to the generated
   `android/app/build.gradle` and fails loudly if it cannot):

```sh
export ERVE_OTA_BASE_URL=https://<DOMAIN_NAME>/mobile-updates/bundles
export VITE_API_URL=https://<API_DOMAIN>            # the API the app talks to

# production APK (what users install)
ERVE_OTA_CHANNEL=production pnpm --filter @erve/mobile exec vite build
ERVE_OTA_CHANNEL=production pnpm --filter @erve/mobile cap:sync
(cd apps/mobile/android && ./gradlew assembleRelease)      # JDK 21

# testing APK (for the test devices only)
ERVE_OTA_CHANNEL=testing    …same two steps, then gradle…
```

3. **Sign** the release APK with the project's *Android* signing key (a
   different key from the OTA key; keep it in the same kind of custody as §1).
   Always sign with the same keystore — Android refuses to upgrade an app signed
   by a different key, and an already-installed APK cannot be re-signed:

```sh
BT=$ANDROID_HOME/build-tools/<version>
$BT/zipalign -f -p 4 app/build/outputs/apk/release/app-release-unsigned.apk erve-<ver>.aligned.apk
$BT/apksigner sign --ks <keystore.jks> --ks-pass file:<pass-file>     --out erve-<ver>-<channel>.apk erve-<ver>.aligned.apk
$BT/apksigner verify --print-certs erve-<ver>-<channel>.apk
$BT/aapt2 dump badging erve-<ver>-<channel>.apk | head -1   # versionCode / versionName
```

`ota ota:fingerprint` prints the native fingerprint, channel and whether OTA is
enabled. The two APKs print the **same** fingerprint; only the channel differs
(verified: the two embedded web bundles are byte-identical). Install the testing
APK only on designated test devices.

A new APK is needed only when the fingerprint changes (§7); raising the version
without a native change is still allowed and simply resets devices to the
embedded bundle once (the next OTA check re-downloads the live release).

### 2.4 Signing identity: verify before every distribution

Android installs an APK over an installed app only if it is signed with the
**same certificate** (or one in the key's rotation lineage) and has a **higher
`versionCode`**. Anything else is refused, and the user's only way forward is to
uninstall — which deletes the app's data and stored login. The repository does
not record which key the APKs already in the field were signed with (the Android
project is generated and git-ignored, and has no signing configuration), so the
only authoritative reference is **an APK that was actually distributed**.

1. **Identify the certificate of what is already in the field.** Take any
   distributed APK (the file you sent out, or pull one from a device with
   `adb shell pm path com.erve.mobile` + `adb pull <base.apk>`) and run:

```sh
pnpm --filter @erve/mobile apk:cert -- <distributed.apk>
#   signer SHA-256  <64 hex>   ← the identity every future APK must carry
# equivalents:  apksigner verify --print-certs <apk>   |   keytool -printcert -jarfile <apk>
```

   Record that SHA-256 in the release notes. It is a public fingerprint, not a secret.
2. **Confirm your keystore is that key** before building anything:
   `keytool -list -v -keystore <keystore> -alias <alias>` — the `SHA256:` line
   must equal the fingerprint from step 1. If it does not, stop: you do not hold
   the key the field APKs were signed with.
3. **Gate every candidate APK** (also for the testing channel):

```sh
pnpm --filter @erve/mobile apk:check -- erve-<ver>-production.apk     --previous <distributed.apk> --channel production     --ota-public-key apps/mobile/ota/ota-public-key.pem
# exit 0 = OK, 1 = DO NOT DISTRIBUTE, 2 = tool/usage error
```

   It refuses an APK that: is signed by a different certificate (or has an extra
   signer); has a `versionCode` not higher than the distributed one; is
   debuggable or signed with the Android debug key; has the wrong package; follows
   the wrong OTA channel; embeds a different OTA public key than the committed
   one; or whose `versionName` disagrees with its OTA app version; or that still
   carries test-build leftovers — a custom network security config or bundled
   certificate (how a test CA gets trusted), cleartext traffic allowed, or an OTA
   update URL that is not a public https URL (`--allow-network-config` /
   `--allow-local-urls` exist for test builds only). Build production APKs from a
   clean `android/` project: delete any `android/app/src/{debug,release}`
   overlays first. With no
   reference it **fails closed** — `--expected-sha256 <hex>` can stand in for
   `--previous`, and `--allow-unchecked` exists only for the first-ever release.
   It needs `apksigner` and `aapt2` (`ANDROID_HOME`/build-tools) and never reads a
   keystore or private key.
4. **If the field APKs were debug-signed, or their key is lost:** there is no
   in-place upgrade. Either (a) recover the key, or (b) accept a one-time
   uninstall-and-reinstall for every device (local data and the stored login are
   lost; OTA cannot help because the identity is part of the APK), or (c) if the
   old key still exists, use APK signature-scheme v3 key rotation
   (`apksigner rotate`) so both keys are accepted. This is an owner decision —
   decide it before the first production APK, not after.
5. **Keystore custody** is the same discipline as the OTA key (§1) but it is a
   **different key**: encrypted, outside the repo (`*.jks`/`*.keystore` are
   git-ignored), at least one encrypted offline backup, two named holders. Losing
   it means no future APK can ever be installed over the current ones.

## 3. Working with the release tree

The server directory is the source of truth. **Always pull before releasing** so
build numbers and manifest sequences continue from what devices have seen:

```sh
SERVER=<SITE_USER>@<host>:<DEPLOY_ROOT>/shared/mobile-updates/bundles
ota ota:sync -- --from "$SERVER" --to "$ERVE_OTA_RELEASE_TREE"     # pull + verify
```

`ota:sync` pushes in a fixed, safe order: (1) new immutable bundle files,
(2) `history.json`, (3) `manifest.json` **last**. Devices see nothing new until
step 3, and a push is refused if the server's manifest is newer than the tree's
(a stale tree would make devices ignore the update).

Safety properties of the remote transport (rsync over SSH; each verified against
a real SSH server, see the readiness report):

- The remote path must be the release directory itself — an absolute path ending
  in `/bundles`. A parent directory or site root is refused outright
  (`--allow-any-remote-path` overrides, for unusual layouts only).
- Every rsync filter is anchored to `<channel>/<fingerprint>/<build>.bundle`,
  `<channel>/history.json` and `<channel>/manifest.json`. `--delete` (retention
  pruning) can therefore only remove expired bundle files in that layout; nothing
  else on the server is ever copied over or deleted, even if the path is wrong.
- A failed or interrupted transfer (disk full, dropped connection) stops before
  the manifest is sent: the live manifest and history stay byte-identical and
  no partial bundle is left under its final name. Fix the cause and re-run the
  same command.
- The manifest is replaced atomically (rsync temp file + rename); readers never
  see a torn file.
- Run on the release workstation: `rsync` and `ssh` must be installed there. The
  SSH key for the site user is separate from the OTA signing key.

## 4. Publish to **testing**

```sh
# build with the SAME environment as the APKs (key, base URL). The channel is not
# part of the bundle, so the build is identical for both channels.
ota build
ota ota:publish -- --keep 10
ota ota:verify                                    # verify the whole local tree
ota ota:sync -- --from "$ERVE_OTA_RELEASE_TREE" --to "$SERVER" --dry-run   # inspect
ota ota:sync -- --from "$ERVE_OTA_RELEASE_TREE" --to "$SERVER"
ota ota:verify -- --url https://<DOMAIN_NAME>/mobile-updates/bundles --channel testing
```

Example output:

```
[ota] published: testing  native 3cfeb4e8…
[ota]   version 0.1.0-ota.1794898549  (build 1794898549, manifest sequence 1794898549331)
[ota]   549568 bytes  content 94f895617fcaeb47…  commit af9ab356…
```

`ota:publish` can only target testing. It refuses: a `dist/` built for another
native fingerprint; a missing `index.html` or build info; hidden files; private
key material; a private key that is not the pair of the compiled-in public key;
an unverifiable existing manifest. It verifies the sealed bundle exactly as a
device would **before** the manifest is replaced; a failure leaves the channel
exactly as it was.

### 4.1 Testing acceptance (on a testing-channel device)

Do not promote until each box is ticked on a real device with the testing APK:

- [ ] App → Account sheet → **Check for updates** shows the new version; it is
      **not** applied while a QA inspection / production update / form is open.
- [ ] After a cold start the new version is active; Account sheet shows
      `0.1.0-ota.<n>` and "This app follows the test update channel".
- [ ] Login persists; offline start still works; a sample QA flow and a
      production-stage update save correctly.
- [ ] Nothing in the change touches native code (the fingerprint did not change).

## 5. Promote **testing → production**

Find the build testers confirmed:

```sh
ota ota:status                         # LIVE testing build per fingerprint
```

Promote exactly that build (the build number is mandatory):

```sh
ota ota:promote -- --build <testing build number>
ota ota:verify
ota ota:sync -- --from "$ERVE_OTA_RELEASE_TREE" --to "$SERVER"
ota ota:verify -- --url https://<DOMAIN_NAME>/mobile-updates/bundles --channel production
```

What happens: the **same bundle file, checksum and signature material** are
copied into `production/` under a new production build number and a higher
production manifest sequence. Nothing is rebuilt or re-encrypted, so production
receives the bytes testers received. The promotion is written to the signed
production history (`promote … from testing build <n>`).

Refused with a clear message when: the build is not the one currently published
to testing; testing has no release for the fingerprint; the bundle fails
verification; production already serves exactly this bundle; the build was made
from uncommitted changes (`+dirty`, override only with `--allow-dirty`).

Devices pick it up at their next launch/resume check (throttled to 1 min / 5 min),
stage it, and apply it at a safe moment (never during a QA inspection,
production update or unsaved form).

## 6. Emergency rollback

Use when a promoted release misbehaves (crash on login, broken screen…).

```sh
ota ota:sync -- --from "$SERVER" --to "$ERVE_OTA_RELEASE_TREE"          # 1. pull latest
ota ota:history -- --channel production                                  # 2. find the last good build
ota ota:rollback -- --channel production --to-build <good build number> \
    --reason "v123 crashes on login (ticket #…)"                          # 3. re-release it
ota ota:verify
ota ota:sync -- --from "$ERVE_OTA_RELEASE_TREE" --to "$SERVER"          # 4. deploy
ota ota:verify -- --url https://<DOMAIN_NAME>/mobile-updates/bundles --channel production
```

`history` marks each entry `[LIVE]` and `[restorable]` (its file is still
retained). The rollback:

- re-releases the **old bytes** under a **new, higher build number** and a
  **higher manifest sequence**, because devices never move to a lower build or
  accept an older manifest; a rollback is therefore a normal forward release;
- needs a `--reason`, recorded in the signed history;
- takes effect on devices at their next check, then applies at a safe moment;
- also protects devices that downloaded but have not yet applied the bad build:
  the higher rollback build supersedes it;
- needs no re-promotion and no new APK. Fix forward afterwards through testing.

A device whose bad build crashed natively is already reverted by the updater
(≈ 20 s) and will not retry that build; it then receives the rollback release
like any other.

Limits: a build whose file was removed by retention cannot be restored
(`--keep` controls how many files are kept; history is never deleted). To return
to the bundle embedded in the APK, publish that commit's build to testing,
verify, and promote it — devices cannot be remotely "reset to embedded".

## 7. Native (APK) changes

Anything under `native/android-template/`, any Capacitor/Cordova plugin change,
permissions, the OTA public key or `native/NATIVE_EPOCH` changes the
fingerprint, so a **new APK is required** and OTA cannot carry it.

1. Build and distribute the new APK (production and testing channel builds).
2. Publish the matching web build to testing and promote it as usual. A
   brand-new fingerprint becomes `latestNativeFingerprint` automatically;
   devices on the old APK keep getting their own release and see "a newer app
   installation is available".
3. Once everyone has updated, withdraw the old generation:
   `ota ota:retire -- --channel production --fingerprint <old> --reason "…"`.
   Devices still on it are then told a new APK must be installed.

Raise `version` in `package.json` for every APK (§2): the app version orders the
generations. A device whose app version is **higher** than the latest published
generation's (a new APK installed before its first release exists) is treated as
up to date, not told to install an app it already has; a device that is the same
or older, or whose versions cannot be ordered, is told to install the newer app.

OTA releases and APK upgrades stay independent: each device only ever receives
the release filed under its own fingerprint (verified three times; see
`OTA_UPDATES.md`).

## 8. Key rotation, loss, compromise

- **Rotation** = new key pair + new APK (the public key is part of the native
  config, so the fingerprint changes). Existing APKs keep trusting the old key.
- **Lost private key:** no new OTA can be signed; ship a new APK with a new key.
- **Suspected compromise:** stop all releases, stop `sync`, generate a new pair
  (§1), ship a new APK for every device, then retire every old fingerprint. There
  is no remote revocation for installed APKs — the old key stays trusted by them
  until they are replaced, which is why custody in §1 matters.

## 9. Retention and history

- `--keep <n>` (default 10) bundle files are retained **per channel and native
  fingerprint** (plus whatever is live). Older files are pruned locally and, with
  `ota:sync` (default), on the server after the new manifest is live
  (`--no-prune` disables).
- `history.json` (signed) is never trimmed. `ota:history` shows what happened and
  which entries are still restorable.
- A bundle is ~0.5 MB; 10 per channel is a few MB.

## 10. Caching

Configured in `deployment/nginx/erve.vhost.example.conf` §3 and checked by
`ota:verify -- --url …` after every deployment:

| Files                           | Header                                  | Why                                                                           |
| ------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| `manifest.json`, `history.json` | `Cache-Control: no-cache` (+ ETag, 304) | Always revalidated: a stale manifest would delay an update or a rollback.     |
| `<fingerprint>/<n>.bundle`      | `public, max-age=31536000, immutable`   | A file name is never reused or rewritten; rollbacks/promotions use new names. |

The tooling refuses to overwrite an existing bundle file. `ota:sync` never
rewrites one either: a local destination refuses a same-name file with different
content, and the rsync form uses `--ignore-existing`.

## 11. Troubleshooting

| Message / symptom                                                                       | Meaning / fix                                                                                           |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `dist/ was built for native fingerprint X but the current native sources hash to Y`     | Rebuild `dist/` on the current commit with the same env, or the native layer changed (§7).              |
| `The private key does not match the OTA public key`                                     | Wrong key file, or the public key was changed after the APK was built.                                  |
| `New builds can only be published to the "testing" channel`                             | By design. Publish to testing, then `ota:promote`.                                                      |
| `Testing build N is not the build currently published`                                  | A newer testing build exists; promote the one testers confirmed only if it is still live, or republish. |
| `…manifest (sequence S) is newer than this tree's`                                      | Your tree is stale. Pull from the server first (§3) and redo the release.                               |
| `Another release operation holds …/.release.lock`                                       | Another run is active. If none is, delete that directory.                                               |
| `ota:verify --url` reports `not served as immutable` / `cacheable without revalidation` | The nginx locations are missing or shadowed by another `location`; fix the vhost.                       |
| Device says "update list was rejected (channel/signature)"                              | APK/channel mismatch or wrong key; check the APK's channel in the Account sheet.                        |

## 12. Production deployment prerequisites (checklist)

Nothing below has been done by this change. None of it requires touching the
VPS until the owner decides to go live.

- [ ] Project owner approves generating the production key; key generated,
      public key committed, backups taken, restore drill done (§1).
- [ ] Release managers named; release workstation prepared (Linux/macOS/WSL with
      `node` 24, `pnpm`, `rsync`, `ssh`).
- [ ] SSH access for the release workstation to the site user that owns
      `<DEPLOY_ROOT>/shared/mobile-updates/bundles/` (write permission; no shell
      beyond rsync required). A dedicated key; **not** the CI deploy key.
- [ ] Production vhost updated with the two OTA `location` blocks and nginx
      reloaded; verified with `ota:verify -- --url`.
- [ ] **Android signing identity established (§2.4):** the certificate of the APKs
      already in the field identified from a real distributed APK; the release
      keystore confirmed to be that key (or the uninstall-and-reinstall / key
      rotation decision taken); keystore custody and backup in place.
- [ ] APKs rebuilt with `ERVE_OTA_BASE_URL` set and the committed public key:
      production APK for users, testing APK for test devices; old APKs (no updater)
      replaced once. **Each APK passes `apk:check` against a distributed APK.**
- [ ] Optional, decision pending: whether signing may ever move into CI (§1.5).
