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

## Biometric login (packaged Android)

Optional, per device. A user signs in with their password first; afterwards the
app offers to turn on biometric login (also available under Account). It uses
Android's native `BiometricPrompt` with **strong (Class 3) biometrics only**:
fingerprint on most phones, face only on devices whose face unlock is Class 3.
Class 2 face unlock cannot protect a Keystore key and is not offered. The device
PIN/pattern is not accepted in place of the biometric.

**What is stored.** The password is never stored. With biometric login on, the
rotating refresh credential exists at rest only as an envelope: a random AES-256
key encrypts it, and that key is wrapped with an RSA public key whose private
half is a Keystore key that requires a strong biometric for every use and is
invalidated when biometrics change. Rotation re-wraps with the public key
(no prompt). Reading it back needs a `BiometricPrompt` bound to the private key.
Turning it on empties the unprotected store (after the user passes the prompt),
and while it is on `getRefreshToken` never consults that store, so there is no
way to read the credential at rest without biometric authentication. After a
successful unlock the credential lives in process memory only and is dropped
when the activity is destroyed, so every cold launch asks again.

**Launch.** With biometric login on and no unlock yet in this process the app
shows an unlock screen (status `locked`): no refresh and no API call is made, and
any leftover access token is discarded. The system prompt opens once
automatically; "Unlock with biometrics" retries and "Use password instead" shows
the normal sign-in form. A successful prompt then goes through the usual
refresh followed by `/auth/me`.

**Server rules still decide.** The biometric prompt only releases the existing
refresh credential, so idle/absolute expiry, revocation, inactive users and
`authVersion` apply exactly as before. A 400/401/403 from `/auth/mobile/refresh`
clears the credential **and** biometric login natively and returns to the
password form with a notice. Offline/5xx keep it and show the retryable
"temporarily unavailable" state. The prompt never extends a session by itself;
the refresh it triggers slides the idle window exactly as a normal cold-start
refresh does.

**Ending it.** Explicit logout, a rejected session, turning it off in Account
(which keeps the current session signed in without the biometric), a changed
biometric enrolment, a removed screen lock, or a lost Keystore key (e.g. a
restored backup) all remove the key and envelope. Biometric login is then off
until the user signs in with a password and turns it on again. Signing in
with the password fallback as the same user keeps it on; signing in as a
different user drops it.

**No biometrics.** Devices without strong biometric hardware, with none
enrolled, or running an APK without the bridge simply don't show the offer; the
Account section explains why. Web and the existing session restoration are
unchanged.

**Limits and what would need the backend.** Biometric login does not outlive the
server session: once the refresh session's idle or absolute timeout passes, the
password is required (the idle window defaults to 20 minutes, the absolute one
to 8 hours; production values are environment settings). Making biometric login
survive that, for example "unlock for days on a trusted phone", cannot be done
safely client-side because it would mean a longer-lived refresh credential than
the server grants. It needs backend support: a per-device registration (device id
plus a public key generated in the Keystore and enrolled after a password
sign-in), a challenge-response endpoint that mints a normal session from a
biometric-signed challenge, its own absolute lifetime and idle policy, per-device
revocation, and revocation on password change or deactivation. Not built here.
Also not done: re-locking the app when it returns from the background in the
same process (only a new process or destroyed activity re-prompts).
