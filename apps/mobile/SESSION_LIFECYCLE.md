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
