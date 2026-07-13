# Capacitor auth cookie verification

The mobile app currently uses the backend's HttpOnly refresh cookie flow. It
does not store refresh tokens in localStorage, sessionStorage, or frontend
state. The access token itself is kept in `sessionStorage` (via
`@erve/client`'s shared token-storage module, also used by the web app) —
not `localStorage` — so it survives a page/WebView reload of the same
session but not a closed tab, a destroyed WebView/process, or a fresh
app launch.

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

## Observed Capacitor Android origin

Confirmed by direct runtime evidence (WebView console via `adb logcat`, and
API-side request logging) on an Android emulator (`sdk_gphone16k_x86_64`,
quick-boot AVD `Medium_Phone`) for a **packaged debug build** installed via
`gradlew assembleDebug` + `adb install`:

- Origin header: `https://localhost`
- WebView URL: `https://localhost/`, `https://localhost/login`, ...
- Scheme: `https`
- Hostname: `localhost`
- Port: none (default `443` implied — Capacitor's default Android scheme is
  `https`, since no `server.url`/`androidScheme` override exists in
  `capacitor.config.ts`)

This differs from other ways of running the app:

- **Capacitor live-reload** (`pnpm cap:run:android:live`, which serves from
  the Vite dev server via `--host localhost --port 5174`): origin is
  `http://localhost:5174`.
- **Browser-based Vite dev** (`pnpm dev` in `apps/mobile`, opened in a
  desktop browser): origin is whatever Vite's dev server binds to
  (`http://localhost:5173` by default, same as web).

Local API `CORS_ORIGIN` must include all of the origins you intend to test
against — see `apps/api/.env.example`.

## Known limitation: session does not survive a full app restart in local dev

With CORS correctly configured, login and in-session requests work end to
end. However, a full app restart (`adb shell am force-stop` + relaunch, not
just background/resume) currently fails to restore the session: the
automatic `POST /auth/refresh` call on cold start returns `401`.

Root cause (confirmed via `adb logcat` + API request logs, not just
inferred): the refresh cookie is issued with `SameSite=Lax`
(`apps/api/src/modules/auth/refresh-cookie.ts`). Chromium's
**schemeful-same-site** cookie policy treats `https://localhost` (the
packaged WebView origin) and `http://localhost:4000` (the local dev API,
plain HTTP) as different sites purely because the scheme differs — so the
`Lax` cookie is not attached to the cross-site `XMLHttpRequest` refresh
call, even though `withCredentials: true` is set and CORS allows the
origin. This is a browser cookie policy, not a CORS problem, and is not
fixed by the CORS allowlist change in this doc.

This only reproduces in local dev, where the API is served over plain HTTP.
A deployed API served over HTTPS would put both origins on `https`, which
does not trigger schemeful-same-site.

Do not work around this by loosening `SameSite`/`Secure` on the refresh
cookie without review — `SameSite=None` requires `Secure`, which requires
HTTPS, which the local dev API does not have. Follow this file's existing
guidance above: prefer a follow-up mobile-specific backend flow over
weakening cookie policy. Background/foreground resume (not a full restart)
is unaffected — the access token stays in memory for the life of the app
process.

## Running API + mobile locally for auth testing

1. Start Postgres and apply migrations/seed as usual for `apps/api`.
2. In `apps/api/.env`, set `CORS_ORIGIN` to include the origin(s) you're
   testing against (see "Observed Capacitor Android origin" above), e.g.
   `CORS_ORIGIN=http://localhost:5173,http://localhost:5174,https://localhost`.
3. `pnpm --filter @erve/api dev`.
4. Forward the API port into the emulator/device:
   `adb reverse tcp:4000 tcp:4000` (the app's `VITE_API_URL` defaults to
   `http://localhost:4000`, which resolves to the device's own loopback
   without this).
5. Build and sync the mobile web assets: `pnpm --filter @erve/mobile build`
   then `pnpm --filter @erve/mobile cap:sync` (or `npx cap sync android`
   from `apps/mobile`).
6. Build and install the debug APK directly when the interactive Capacitor
   device picker isn't usable:
   `cd apps/mobile/android && ./gradlew.bat assembleDebug`, then
   `adb install -r app/build/outputs/apk/debug/app-debug.apk`.
7. Launch the app:
   `adb shell monkey -p com.erve.mobile -c android.intent.category.LAUNCHER 1`.
8. Sign in with a seeded dev account (`pnpm --filter @erve/api prisma:seed`
   creates a dev-only bootstrap admin — see `apps/api/prisma/seed.ts` for
   the default credentials; rotate/override via `SEED_ADMIN_EMAIL`/
   `SEED_ADMIN_PASSWORD` outside local development).

## Verifying refresh-cookie behaviour

- Watch the API dev server's request log (`morgan`) while signing in —
  `POST /auth/login` should return `200` and a `Set-Cookie` for
  `erve_refresh_token`.
- Use `adb logcat -s Capacitor:D Capacitor/Console:E` (or `chrome://inspect`
  remote debugging against the emulator) to see the WebView's own CORS/
  network console errors if a request fails — this is the fastest way to
  distinguish a CORS rejection (`blocked by CORS policy`) from a cookie
  policy rejection (silently missing `Set-Cookie` on the follow-up request)
  from a plain connectivity failure.
- Background the app and resume it (not a full restart) — the in-memory
  access token should still be valid and no re-login should be required.
- See "Known limitation" above for why a full restart currently does not
  restore the session against the local HTTP dev API.

## Verifying theme persistence

- Sign in, open the Dashboard's Preferences card, and change the theme
  selection (Light / Dark / Use device setting). The selection is stored
  under the `erve.themePreference` key (device-local storage, independent
  of the auth session) — it survives logout and app restart even though the
  auth session itself does not.
- Force-stop and relaunch the app: the previously selected explicit mode
  (Light/Dark) should still be selected, and "Use device setting" should
  still show the correct "Currently light/dark" resolution for the device's
  current system setting.

## Verifying background → system-theme change → resume behaviour

1. Set the theme selector to "Use device setting".
2. Send the app to the background (`adb shell input keyevent KEYCODE_HOME`).
3. Change the emulator's system appearance (`adb shell cmd uimode night
   yes|no`).
4. Resume the app (`adb shell am start -n com.erve.mobile/.MainActivity`).
5. Confirm the resolved theme matches the new system setting.

Also test flipping the system appearance multiple times while backgrounded,
then resuming once — the app should reflect only the final system state.

Both scenarios were verified working via `matchMedia`'s `change` listener
alone, with no `@capacitor/app` lifecycle workaround, on a
`sdk_gphone16k_x86_64` (Android emulator, API level matching the
`Medium_Phone` quick-boot AVD image). If a future device/OS combination is
found where a backgrounded WebView misses the `matchMedia` change event,
extend `@erve/theme` with a refreshable system-preference signal and use
`@capacitor/app` only as the lifecycle trigger — do not duplicate theme
resolution logic into `apps/mobile`.

## Android native theme integration

`apps/mobile/android` is gitignored and has never been committed (confirmed
via `git log --all -- apps/mobile/android` returning nothing) — it is
Capacitor-generated output, fully reproducible via `cap add android` /
`cap sync`. Rather than tracking the generated platform, native theme
resources live in a small source-controlled template that is re-applied
after every sync:

- **Source of truth**: `apps/mobile/native/android-template/` (colors.xml /
  styles.xml for `values` and `values-night`, plus `MainActivity.java` and
  `NativeThemeBridgePlugin.java`).
- **Generation script**: `apps/mobile/scripts/configure-android-theme.mjs` —
  copies the template files on top of the generated `android/` tree. Pure
  whole-file copies (never partial/regex edits), so it is safe to rerun and
  always produces identical output for the same template
  (`android-native-theme.test.ts` proves this against a locally generated
  platform).
- **Wired into**: `pnpm --filter @erve/mobile cap:sync` and
  `cap:add:android` already run it automatically. Run it standalone with
  `pnpm --filter @erve/mobile native:theme:android` after any manual
  `npx cap sync android`.
- **Never hand-edit** `android/app/src/main/res/values{,-night}/{colors,styles}.xml`
  or `android/app/src/main/java/com/erve/mobile/*.java` directly — those
  edits are silently lost the next time `cap sync`/`cap add android` runs
  (they are gitignored and not read by the generation script). Edit the
  files under `native/android-template/` instead.

### What this fixed

The stock `cap add android` scaffold had no `colors.xml` at all —
`colorPrimary`/`colorPrimaryDark`/`colorAccent` silently resolved to the
default AppCompat/Cordova AAR values (indigo `#3F51B5`/pink
`#FF4081`/indigo-dark `#303F9F`), and the splash/activity background was a
single non-`values-night`-aware white drawable, so a system-dark device saw
a white flash on cold start. The template now defines those colors from
`packages/theme/src/theme.css`'s `--erp-color-primary` / `--erp-color-app-bg`
(light and `.dark`), with `values-night` variants so Android resource
qualifiers pick the right one before any JavaScript runs.

### Resource mapping

| Android resource | Source (theme.css) | Light | Dark |
| --- | --- | --- | --- |
| `erve_primary` | `--erp-color-primary` | `#C21530` | `#C21530` |
| `erve_window_background` / status/nav bar / splash bg | `--erp-color-app-bg` | `#EEF3F8` | `#020617` (splash uses `--erp-color-surface` `#0F172A`, see limitation below) |

### Status bar, navigation bar, and splash

- **Status bar**: `@capacitor/status-bar` (`src/theme/NativeThemeSurfaces.tsx`)
  sets icon style (`Style.Dark`/`Style.Light`) and background color on every
  `resolvedTheme` change from `useTheme()`. `setBackgroundColor` /
  `setOverlaysWebView` are documented by the plugin itself as unavailable on
  Android 15+ (edge-to-edge is OS-enforced there); on those OS versions the
  WebView's own `--erp-color-app-bg` shows through the transparent bar
  instead, and only the icon-style call has any effect. Startup appearance
  (before JS runs) comes from `android:windowLightStatusBar` in
  `values`/`values-night` styles.xml.
- **Navigation bar**: no official Capacitor plugin covers this. A minimal
  first-party plugin (`NativeThemeBridgePlugin.java`, registered in
  `MainActivity.java`) exposes `setNavigationBarAppearance` using only public
  `Window`/`WindowInsetsControllerCompat` APIs (no reflection). Same Android
  15+ edge-to-edge caveat as the status bar. Startup appearance again comes
  from the `values`/`values-night` theme.
- **Splash**: uses the AndroidX Core SplashScreen compat theme
  (`Theme.SplashScreen`, already `coreSplashScreenVersion` in
  `variables.gradle`) with `windowSplashScreenBackground` sourced from
  `values`/`values-night`, so the correct background is known before JS
  runs. `@capacitor/splash-screen` is installed with `launchAutoHide: false`
  in `capacitor.config.ts`; `NativeThemeSurfaces` calls `SplashScreen.hide()`
  once React has mounted, so the splash never dismisses onto an unthemed
  WebView frame.

### Known limitations (not fixed here — see final report for detail)

- **Splash/launcher branding**: the splash icon
  (`res/mipmap-*/ic_launcher_foreground.png`) and app launcher icon are
  still the placeholder Capacitor scaffold mark, not an Erve asset — there
  is no approved dark-mode-safe Erve icon lockup yet. This task deliberately
  did not invent one; branding the launcher/splash icon is a separate design
  task.
- **Explicit-mode-vs-OS-mode startup mismatch**: before JavaScript runs,
  native resources only know the OS light/dark setting. If a user explicitly
  picked a mode that differs from the OS setting, the very first native
  frame (splash/status/nav bar) can briefly use the OS variant before
  `theme-init.js` and `NativeThemeSurfaces` correct it once the WebView
  loads. Not fixed here per this task's scope (native preference sync was
  explicitly out of scope pending a separate review).
- **Android 15+ (API 35, this project's `targetSdkVersion`) forces
  edge-to-edge**: `statusBarColor`/`navigationBarColor` (both the theme
  attributes and the plugin/bridge calls) are no-ops there by OS design;
  only icon-appearance calls have any effect, and the WebView's own
  background provides the perceived bar color.

### Verification checklist

- [ ] Cold start, system light: no white/blue flash, status/nav bar and
      splash all match the light app background, dark icons.
- [ ] Cold start, system dark: no white/blue flash, status/nav bar and
      splash all match the dark app background, light icons.
- [ ] Manual theme switch (Light/Dark/System) while running: WebView, status
      bar, and navigation bar (where the OS version supports it) update
      together.
- [ ] System appearance changed while backgrounded, then resumed: final
      state matches the new system setting (see "Verifying background →
      system-theme change → resume behaviour" above for the underlying
      `matchMedia` mechanism).
- [ ] Restart with each persisted mode (Light/Dark/System): note whether the
      startup mismatch above is visible.
- [ ] `pnpm --filter @erve/mobile test` includes
      `native/android-template/android-native-theme.test.ts`, which checks
      the template's colors against `theme.css`, cross-references XML color
      references, and (only when `android/` has already been generated
      locally) that the generation script is idempotent.

### Regenerating the Android platform from a clean checkout

```sh
pnpm install
pnpm --filter @erve/mobile build
pnpm --filter @erve/mobile cap:add:android   # or: npx cap sync android && pnpm --filter @erve/mobile native:theme:android
cd apps/mobile/android && ./gradlew.bat assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## CORS warning

Never combine a wildcard (`*`) `Access-Control-Allow-Origin` with
`credentials: true` — browsers reject that combination for good reason, and
it would defeat the purpose of an HttpOnly, cookie-based refresh flow.
`apps/api/src/config/cors.ts` validates the request `Origin` against an
explicit, exact-match allowlist (`CORS_ORIGIN`, comma-separated) and never
reflects an arbitrary submitted origin.
