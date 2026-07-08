# Capacitor auth cookie verification

The mobile app currently uses the backend's HttpOnly refresh cookie flow. It
does not store refresh tokens in localStorage, sessionStorage, or frontend
state.

Before shipping mobile auth changes, verify on Android and iOS devices or
emulators:

- Login succeeds and the backend `Set-Cookie` refresh session is accepted by
  the WebView.
- Restarting the app after login restores the session through `/auth/refresh`
  and then `/auth/me`.
- A protected request made after the 5-minute access token expiry refreshes the
  access token and retries once.
- After 20+ minutes of inactivity, the next protected request fails refresh and
  routes the user to login.
- Logout calls `/auth/logout`, clears the access token, and clears the backend
  refresh cookie.
- The HttpOnly refresh cookie survives app restart on both platforms.

If cookie persistence fails in Capacitor, do not move refresh tokens into
localStorage. Prefer a follow-up mobile-specific backend flow that returns a
mobile refresh credential stored with native secure storage.

Potential backend settings to recheck during device testing:

- `CORS_ORIGIN` includes the mobile WebView/dev origins.
- Cookie `SameSite` and `Secure` settings work for the deployed API/mobile
  origin combination.
