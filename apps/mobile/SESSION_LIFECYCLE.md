# Mobile session lifecycle

Browsers use the backend's HttpOnly refresh cookie. Packaged Android uses the
mobile refresh exchange and stores the rotating refresh credential through a
first-party Capacitor bridge backed by an Android Keystore AES/GCM key and
private encrypted preferences. Refresh credentials are never written to
localStorage, sessionStorage, or ordinary WebView storage. The short-lived
access token remains in sessionStorage and is recreated after process death.

On cold start the app attempts refresh before deciding that the user is signed
out, then calls `/auth/me`. A 401/403 clears local auth and returns to login.
Offline, transport, and 5xx failures show a retryable unavailable state without
clearing the secure credential. Token rotation, server-side revocation,
inactive-user checks, idle/absolute expiry, and `authVersion` validation are
the same for cookie and packaged-mobile sessions.

Packaged Android uses `/auth/mobile/login`, `/auth/mobile/refresh`, and
`/auth/mobile/logout`. The WebView handles a credential only transiently while
passing it between the API and native bridge. In production these endpoints
fail closed unless Express sees HTTPS and Origin is exactly
`https://localhost`. Browser and live-reload configurations retain the
HttpOnly-cookie endpoints. Local packaged testing may use `adb reverse` with
HTTP only while the API is explicitly in development mode.

Verification requires a packaged APK: sign in, force-stop the app, relaunch,
observe refresh followed by `/auth/me`, then repeat for revoked/inactive,
offline, and transient-5xx cases. Browser-only results are insufficient.

Over-the-air web updates (see [OTA_UPDATES.md](./OTA_UPDATES.md)) do not affect
the session: a bundle switch keeps the `https://localhost` origin, so
`sessionStorage` and `localStorage` are retained, and the refresh credential in
the Keystore-backed bridge is never touched. Updates are never applied while a
save, an unsaved form or an open QA/production screen is present.

## Two separate things: a session and a trusted device

| | Authentication **session** | **Trusted device** (biometric sign-in) |
|---|---|---|
| What it is | Access token + rotating refresh credential (`refresh_sessions`) | A server record holding one phone's **public** key (`trusted_devices`) |
| Created by | Password sign-in, or a biometric sign-in | Turning on biometric login, from a **password** session |
| Lifetime | Idle 20 min / absolute 8 h (`JWT_REFRESH_*`) | **Absolute 30 days** from registration (`TRUSTED_DEVICE_LIFETIME_DAYS`), never extended |
| Ended by | Logout, idle/absolute expiry, revocation, password reset, deactivation | Turn off, remove from another phone, expiry, password reset, deactivation |
| Logout | **Ends it** | **Leaves it untouched** |
| Holds | Bearer secrets (refresh token) | No secret the server can use to impersonate: only a public key |

A trusted device never stores or replays a password, a refresh token or any
long-lived bearer token. It can only prove, with a private key that lives in the
phone's Keystore and needs a strong biometric for every use, that the person
holding the phone is allowed to ask the server for a brand-new session. The new
session is created by the same code as a password login (`createRefreshSession`
→ `issueTokenResponse`), so idle/absolute expiry, rotation, reuse detection,
inactive-user checks and `authVersion` validation all apply to it unchanged.

## Biometric sign-in (packaged Android)

Optional, per phone. The user signs in with their password first; the app then
offers to turn biometric login on (also under **Account**). It uses Android's
native `BiometricPrompt` with **strong (Class 3) biometrics only**: fingerprint
on most phones, face only on phones whose face unlock is Class 3. Class 2 face
unlock cannot protect a Keystore key and is not offered. The device
PIN/pattern is never accepted in place of the biometric.

### What the user experiences

| Situation | Result |
|---|---|
| First sign-in after install | Username and password |
| Turn on biometric login (from a password session) | One biometric prompt; the phone is registered |
| Close and reopen the app | Opens on **Sign in with biometrics** (the prompt opens by itself) and **Sign in with password** |
| Log out | Session ends; the biometric registration stays. The screen shown next offers **Sign in with biometrics** (prompt opens on tap) and **Sign in with password** |
| Biometric succeeds | A **fresh** server session is created and the dashboard opens, with no password |
| Biometric cancelled or fails | Stay on the screen; retry or sign in with the password |
| The previous session expired or was revoked | Biometric sign-in still creates a new one while the phone's authorization is valid |
| Authorization expired, revoked, user deactivated, password reset | A clear message and the password form; turning it on again needs a password sign-in |
| Fingerprints added or removed, or screen lock removed | The key is invalidated; the app says so and asks for the password |
| Already registered | The app does not ask to turn it on after every password sign-in |

### Registration (password session → trusted device)

1. The app creates an **EC P-256** key pair in the Android Keystore:
   non-exportable, `PURPOSE_SIGN`, SHA-256, user authentication required **per
   use** with `AUTH_BIOMETRIC_STRONG`, invalidated by new biometric enrolment.
   Only the public key (SPKI DER) leaves the phone.
2. `POST /auth/trusted-devices/challenge` (authenticated) returns a random
   single-use challenge bound to the signed-in user.
3. The app asks for a strong biometric through `BiometricPrompt` bound to the
   key and signs the challenge text.
4. `POST /auth/trusted-devices` sends `{challengeId, publicKey, signature,
   label, appVersion}`. The server takes the **user from the access token**
   (never from the body), requires the token to belong to a **password**
   session (`403 PASSWORD_SIGN_IN_REQUIRED` otherwise: a session started by
   biometrics cannot mint a new authorization, so use never renews itself),
   consumes the challenge atomically, verifies the signature with the
   submitted key, and stores the registration with `expiresAt = now +
   TRUSTED_DEVICE_LIFETIME_DAYS`, the user's current `authVersion`, and an
   audit entry.
5. Only now does the phone mark itself registered. If that last local step
   fails, the app revokes the just-created server record.

### Sign-in (challenge → biometric signature → new session)

1. `POST /auth/mobile/trusted-device/challenge {deviceId}` (unauthenticated,
   HTTPS/origin-checked like the other mobile endpoints, rate limited). The
   server answers `401 DEVICE_AUTHORIZATION_INVALID` if the device is unknown,
   revoked, expired, its user is not `ACTIVE`, or the user's `authVersion` has
   moved on; otherwise it returns a 32-byte random nonce valid for
   `TRUSTED_DEVICE_CHALLENGE_TTL_SECONDS` (60) and the exact text to sign:
   `erve-trusted-device/v1`, purpose, challenge id, nonce, user id, device id.
   Asking first means being offline never reaches the prompt.
2. The app shows `BiometricPrompt` bound to the key. A strong biometric is
   required for **this one signature**.
3. `POST /auth/mobile/trusted-device/sign-in {deviceId, challengeId,
   signature}`. The server **consumes the challenge first** (one atomic update
   that only succeeds for an unused, unexpired `SIGN_IN` challenge of exactly
   this device), then re-checks the device and account, rebuilds the signed
   text from its own record (never from the client) and verifies the ECDSA
   signature against the stored public key. Any failure leaves the challenge
   burned.
4. On success it creates a new refresh session marked `TRUSTED_DEVICE`, returns
   the usual `{accessToken, refreshToken, user, session}` plus the device's
   expiry, updates `lastUsedAt` and audits it.

Replay, a second use of a challenge (including two simultaneous submissions),
an expired challenge, another device's or account's challenge or key, and a
registration challenge presented as a sign-in are all rejected; each is
covered by an automated test.

### Log out versus Turn off biometric login

| | **Log out** | **Turn off biometric login** (Account) |
|---|---|---|
| Server session | Revoked (`/auth/mobile/logout`) | Kept (you stay signed in) |
| Refresh credential and access token | Cleared | Kept |
| Biometric key and registration | **Kept** | **Deleted** on the phone |
| Server device authorization | **Kept** | **Revoked** |
| Next time | Biometric sign-in offered | Password required; the app can offer to turn it on again |

Turn off is **local first**: the signing key is deleted before any network call,
so from that moment this phone cannot authenticate whatever the server still
says. The server revocation is then sent; if the phone is offline or the server
errors, the pending revocation (device id and user id, no secret) is stored on
the phone, shown in Account, and retried automatically the next time that user
is signed in (or with "Cancel it now"). Nothing is silently trusted or silently
dropped.

Removing a **different** phone from Account revokes its authorization and the
sessions it started. A different account signing in with a password on a phone
registered to someone else deletes that key (the previous account's server
record is revoked the next time they sign in, or expires).

### Server-side lifetime and revocation policy

* **Lifetime.** `TRUSTED_DEVICE_LIFETIME_DAYS`, default **30**, range 1-365,
  absolute from registration. Use never extends it, and there is no idle policy
  or "never expires" setting. After it the user signs in with a password and
  turns biometric login on again.
* **Challenges.** `TRUSTED_DEVICE_CHALLENGE_TTL_SECONDS`, default 60, single use;
  expired challenges are pruned opportunistically.
* **Devices per user.** `TRUSTED_DEVICE_MAX_ACTIVE_PER_USER`, default 10
  (`409 DEVICE_LIMIT_REACHED`); one registration per public key.
* **Revoked automatically** by an administrator **password reset** (together
  with every session), by **deactivation/suspension**, and, as a second line,
  whenever the user's `authVersion` differs from the one recorded at
  registration. Reactivating an account does not bring devices back.
* **Revoked by the user** via `DELETE /auth/trusted-devices/:id`
  (owner only; `?revokeSessions=false` keeps the sessions that device started,
  which "Turn off" uses). `GET /auth/trusted-devices` lists the caller's active
  devices (label, dates; never key material).
* **Rate limits** (shared database buckets, so they hold across API
  instances): challenges 60/min per IP and 10/min per device; sign-ins 30/min
  per IP and 10/min per device; registration challenges 30/min per IP and 20/h
  per user; registrations 20/h per user. Over the limit: `429`.
* **Audit** (`audit_logs`): `TRUSTED_DEVICE_REGISTERED`, `TRUSTED_DEVICE_SIGN_IN`,
  `TRUSTED_DEVICE_SIGN_IN_FAILED` (with a reason), `TRUSTED_DEVICE_REVOKED` and
  `TRUSTED_DEVICES_REVOKED` (password reset/deactivation), each with the acting
  IP where known. Challenges and public keys are not logged.

### Where credentials live on the phone

* Not registered: exactly as before: the refresh credential is encrypted with a
  non-authenticated Keystore AES key in private preferences.
* Registered: the refresh credential is held in **process memory only** and is
  dropped when the activity is destroyed. Every cold start signs in with the
  biometric, so nothing is left at rest to steal. Rotation keeps updating it in
  memory. Logging out or a rejected/expired session clears it.
* The private key is in the Keystore and cannot be exported. The registration
  metadata (device id, user id, expiry hint) is not secret. The password is
  never stored anywhere.
* After a successful biometric sign-in the access token is a normal one. Sessions
  it starts keep the normal 20-minute idle / 8-hour absolute limits.

### Failure handling

| Failure | Behaviour |
|---|---|
| Offline, timeout, 5xx while asking for the challenge | Message and retry; no prompt is shown; registration kept |
| 429 | "Too many attempts"; wait or use the password; registration kept |
| Prompt cancelled / negative button / lockout | Stay on the screen; password available; registration kept |
| `401 DEVICE_AUTHORIZATION_INVALID` or `INVALID_SIGNATURE` | The phone deletes its key, shows "no longer authorized", offers the password |
| Challenge expired or already used (`400`) | Generic failure; try again (a new challenge is fetched) |
| Biometrics changed, lock screen removed, key missing (also a restored backup) | Key and registration dropped; pending revocation remembered; explained on the password form |
| Turn off while offline | Local key deleted at once; revocation pending and retried (see above) |
| Server rejects the session after sign-in | Normal session handling (re-sign in) |

Stale biometric state can never block the password form: it is one tap away on
every screen, and a password sign-in replaces any leftover configuration.

### Upgrades, reinstalls and backups

* The registration lives in the app's private storage and a Keystore key. A
  reinstall, "clear data" or a restored backup loses the key, so it cannot sign
  in; a restored copy of the metadata without the key is detected on the next
  status check and discarded. The generated manifest also excludes the
  registration and credential preference files from Auto Backup and device
  transfer (`res/xml/erve_backup_rules.xml`, `erve_data_extraction_rules.xml`,
  applied by `scripts/configure-android-theme.mjs`).
* An orphaned server record (reinstall, wiped phone) cannot be used without the
  key; it expires with its lifetime and can be removed from Account on another
  phone.
* An OTA web update does not touch any of this. An APK upgrade keeps it.

### Migration from v0.2.0

v0.2.0 protected the refresh credential itself behind the biometric: no
server-side device, and logging out wiped it. v0.3.0 replaces that with the
trusted-device design above. Upgrading over v0.2.0:

* A phone that had v0.2.0 biometric login on opens on **Sign in with
  biometrics**. One prompt moves the **working session** out of the old
  envelope into the ordinary store (session preserved when it is still valid at
  the server), then the old key and envelope are deleted. If biometrics changed
  meanwhile, or the envelope is unreadable, the old configuration is discarded
  and the password form opens with an explanation.
* **No trusted device is created automatically.** The old refresh credential is
  never turned into a device authorization. After the session is restored the
  app shows "Upgrade biometric login?"; only if the user agrees does the normal
  registration run (one new prompt, from the password-established session,
  which is at most 8 hours old). Until then the phone behaves like one with
  biometric login off, including password sign-in after logout.
* "Use password" works at any moment: a password sign-in discards the stale
  v0.2.0 configuration so it can never block signing in. Unrelated app data
  (OTA state, the theme, "Not now" choices) is never touched.
* v0.2.0 biometric state cannot be created any more.

### Security limitations

* Biometrics authenticate whoever is **enrolled on the phone**, not necessarily
  the account owner: anyone whose fingerprint or Class 3 face is enrolled can
  sign in as the registered user on that phone. Only enrol your own.
* The server cannot verify that the key is hardware-backed or biometric-gated
  (no Android Key Attestation is checked). A modified app that already holds a
  password session for an account could register a software key for that same
  account; it cannot affect other accounts. Attestation verification is the
  natural next hardening.
* A rooted or instrumented phone can defeat any on-device protection. The
  design limits the blast radius: the key never leaves the Keystore, each use
  needs a fresh biometric, and the authorization is time-boxed and revocable.
* Process-level lock only: returning from the background in the same process
  does not re-prompt; a new process or destroyed activity does.
* Revocation by the user covers only their own devices. There is no
  administrator "revoke this user's devices" action beyond password reset and
  deactivation, and no self-service password change exists to hook into.
* Rate limiting by IP relies on the proxy chain being trusted (`trust proxy`
  is `1`); per-device and per-user limits do not.
* The web app has no biometric sign-in.

### Verification

Required on a packaged APK, not a browser. Emulator results for this
implementation, plus the physical-device items still to do, are in the pull
request. Run: sign in with the password, turn biometric login on, **log out**,
close the app, reopen it, sign in with the fingerprint, and confirm in
`refresh_sessions` that a new row with `auth_method = TRUSTED_DEVICE` exists and
the dashboard opened without a password; repeat the cycle.
