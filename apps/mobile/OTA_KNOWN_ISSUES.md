# OTA release-candidate: outstanding issues

Found while verifying the OTA feature on an emulator. **None is fixed in the OTA
pull request**; each is either outside the OTA scope (shared authentication, QA
pages), needs a decision only the project owner can take, or needs hardware that
was not available. They are recorded here so they are not lost.

Status of each: *evidence* is what was actually observed; *not verified* says
what was not.

---

## 1. A lost refresh response can lead to session revocation

**Scope:** shared client (`packages/client/src/api-client.ts`) and the auth
backend. Pre-existing; used by web and mobile. Not caused by OTA.

**Observed (debug APK, DevTools trace):** with response latency pushing a token
refresh past 30 s, the client aborted the request (`net::ERR_ABORTED` exactly 30 s
after it was sent — `REFRESH_TIMEOUT_MS`) although the server had already
processed it (`POST /auth/mobile/refresh 200`) and rotated the refresh token. The
client never stored the new token, and no retry of the original request was sent.
The server honours the *previous* token for `REFRESH_ROTATION_GRACE_SECONDS`
(60 s) so that a lost response can be retried. A follow-up refresh inside that
window succeeded; one made minutes later was answered 401 (reuse), the session was
revoked and the app returned to `/login`.

**Impact:** on a slow or flaky network a user can be signed out mid-shift, losing
any unsaved work. The write that triggered the refresh is not committed.

**Recommended (decision needed — it changes shared auth):** retry the refresh once,
immediately, when it fails by timeout or network error with the same token (the
server design already makes that safe inside the grace window). Consider whether
the 30 s timeout should be longer on mobile.

**Not verified:** how often this happens on real mobile networks.

## 2. QA evidence-upload failures are silent

**Scope:** `src/pages/qa/QaInspectionPage.tsx` (and the attachment handlers in
`QualityExecutionPage.tsx`). Pre-existing.

**Observed:** the evidence file input's `onChange` does
`await apiClient.post('/qa/inspections/<id>/evidence', body)` and then
`await query.refetch()` with no `try/catch` (`QaInspectionPage.tsx` lines 609–617).
`errors.evidence` is only ever set by form validation. When the request fails
(observed with an authentication failure) the rejection is unhandled and the user
sees no message and no attachment — nothing tells them the photo is missing.
`QualityExecutionPage.tsx` `upload` and `removeAttachment` (lines 84–95) likewise
do not catch at the call site.

**Not verified:** what the shared `onUpload` consumer component does with a
rejection (it was not inspected); behaviour on the other upload failure modes
(offline, 413, 5xx).

**Recommended:** catch, show a retryable error, and keep the chosen file so the
user does not have to re-take the photo.

## 3. Final QA and camera not tested on physical Android devices

**Tested (emulator, debug APK):** evidence upload through Android's real photo
picker; Inline QA unsaved entries and an in-flight save; PP Sample (legacy
`/qa/:id`) page; prepared-quantity entry and in-flight submit; unsaved form
detection; background/resume; cold-start activation; native rollback; offline
start.

**Not tested:**
- the **Final QA execution page** (it needs a batch allocation form that could not
  be driven with the automation used). It shares `QualityExecutionPage`, its route
  guard and its save path with Inline QA, which was tested — that is inference,
  not observation;
- the **real camera** (`capture="environment"`): the emulator opens the photo
  picker instead;
- **any physical device**, any Android version other than the emulator's, OEM
  WebView/battery behaviour, real cellular conditions.

**Needed before the first production release:** one tester on a physical device
runs PP Sample, Inline and Final QA with a real photo, with an update staged, and
confirms the update only installs afterwards.

## 4. The production APK signing certificate is not identified

**Scope:** release process. Nothing in the repository records which key signed the
APKs already in the field (the Android project is generated and git-ignored and has
no signing configuration).

Android only installs an APK over an installed app if it carries the same
certificate (or one in its rotation lineage) and a higher `versionCode`. A mismatch
forces an uninstall, which deletes the app's data and stored login.

**Action for the owner, before the first signed APK:** identify the certificate of
a distributed APK and confirm the release keystore matches it
(`OTA_RELEASE_RUNBOOK.md` §2.4):

```sh
pnpm --filter @erve/mobile apk:cert -- <distributed.apk>
keytool -list -v -keystore <keystore> -alias <alias>     # SHA256 must be equal
pnpm --filter @erve/mobile apk:check -- <new.apk> --previous <distributed.apk> \
    --channel production --ota-public-key apps/mobile/ota/ota-public-key.pem
```

If the field APKs were debug-signed, or their key is lost, there is no in-place
upgrade; the owner must choose between recovering the key, a one-time
uninstall/reinstall, or key rotation (runbook §2.4 step 4).

## 5. OTA guard expiry versus unresolved server-side writes

**What the code does** (`src/ota/inflight-writes.ts`, `src/ota/update-guards.ts`):
an update is never activated while a write is on the wire or a save is pending.
Two bounds exist so that a connection that dies silently cannot hold updates until
the app is restarted:
- an HTTP attempt that has not settled after **10 minutes** is dropped from the
  in-flight count (the API client has no request timeout of its own except for
  token refresh);
- a `useMutation` save pending for more than **10 minutes** is ignored by the guard.

After the last attempt settles, the guard stays up a further **3 seconds** (the gap
between a refresh finishing and its retry being sent).

**The residual risk:** if a write is still unresolved when a bound is reached, the
update may activate and reload the WebView, aborting the request client-side while
the server may or may not have committed it. The user then sees a fresh page and no
confirmation either way.

- Writes issued through `useMutation` carry idempotency keys derived from the job
  version (for example `<jobOrderId>:prepared:<version>`), so re-submitting is
  deduplicated by the server.
- Evidence and attachment uploads are **not** idempotent: if the user repeats an
  upload whose first attempt was committed but never confirmed, a duplicate may be
  stored. (A failed upload is also silent — issue 2.)

**Not verified:** what the server does when a client disconnects mid-upload (whether
it completes or discards the request).

**Recommended:** give non-refresh requests an explicit timeout so "unresolved"
becomes a definite error well inside the guard window, and make evidence upload
idempotent on the server. Neither is part of this change.

---

### Related limitations (documented in `OTA_UPDATES.md`)

- Stalled downloads take up to ~5 minutes to fail (nothing partial is ever staged).
- Resume checks are rate-limited to once per 5 minutes; "Check for updates" bypasses it.
- Returning devices to the embedded bundle needs a re-release; there is no remote
  reset or key revocation.
- A signed manifest with a mistakenly high sequence locks devices until a higher one
  is published.
