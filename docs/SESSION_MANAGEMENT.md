# Session management

How ERVE keeps signed-in users signed in while they work, and how sessions
end. The server is always the authority on whether a session is valid; the
web client only schedules renewals and warnings around the instants the
server reports.

## Tokens and timeouts

| Setting (`api.env`)                  | Source default | Meaning                                                                                                             |
| ------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------- |
| `JWT_ACCESS_EXPIRES_IN`              | `5m`           | Lifetime of the short-lived access token. Renewed silently.                                                         |
| `JWT_REFRESH_IDLE_TIMEOUT_MINUTES`   | `20`           | **User inactivity** allowed before the session ends. Slides only on genuine user activity (see below).              |
| `JWT_REFRESH_ABSOLUTE_TIMEOUT_HOURS` | `8`            | Hard cap from sign-in. Activity and "Continue Session" never extend a session past it; the user must sign in again. |

Changing `JWT_REFRESH_IDLE_TIMEOUT_MINUTES` applies to existing sessions
immediately (idle expiry is computed from the last activity and the current
setting). For example `JWT_REFRESH_IDLE_TIMEOUT_MINUTES=240` means a session
ends after four hours without user interaction, still capped by the
absolute timeout.

## What counts as activity

The web app listens (capture phase) for `keydown`, `input`, `change`,
`pointerdown`, `click`, `touchstart`, `wheel` and `scroll`, only while the tab
is visible. Timers, background queries and hidden tabs are never activity.

Activity is throttled (one processed event per 5 seconds). When the server's
idle expiry last slid more than `min(4 min, idle timeout / 4)` ago — or the
access token has under a minute left — the client refreshes with
`{ "activity": true }`, which slides the idle expiry. Any other refresh
(e.g. a background request that got a 401) sends `{ "activity": false }` and
rotates tokens without extending the session. Clients that send no flag
(mobile, older builds) are treated as active, as before.

## Contract

`POST /auth/login`, `POST /auth/refresh` and the `/auth/mobile/*` equivalents
return a `session` object: `userId`, `serverTime`, `accessExpiresAt`,
`idleExpiresAt`, `absoluteExpiresAt`, `idleTimeoutSeconds`. `serverTime` lets
the client correct for a skewed device clock.

## Refresh-token rotation safety

Each refresh rotates the refresh token. The successor is derived
deterministically from the presented token, so:

- two tabs refreshing with the same token both receive the same successor;
- if a rotation's response is lost, retrying the previous token within 60
  seconds returns the successor already issued (no DB change);
- any older token, or the previous token after 60 seconds, is treated as
  reuse and revokes the session.

A failed refresh never clears the refresh cookie (a stale request must not
wipe a newer cookie set by another tab). Explicit logout still clears it.

In the browser, refreshes are serialised across tabs with the Web Locks API
and the result is shared over `BroadcastChannel`, so one tab's renewal serves
all tabs. If another tab signs in as a different user, existing tabs reload
to the login page rather than keep showing the previous user.

## What the user sees

- **Active:** nothing — renewal is silent and never reloads or navigates.
- **Idle:** 5 minutes before idle expiry, "Your session will expire soon"
  with a countdown and **Continue Session**. Continue renews in place;
  interacting with the page has the same effect.
- **Absolute limit near:** "Your session is ending" (cannot be extended).
- **Expired:** a sign-in dialog over the current page. The page stays
  mounted, so unsaved form input survives. Requests that failed while signed
  out (e.g. a save) are not replayed; the user saves again. Signing out from
  there, or opening a protected page while signed out, goes to `/login`,
  which returns to the interrupted page afterwards.
- **Server/network unavailable at start-up:** a retryable "Unable to reach
  ERVE" screen instead of the login page.
- **Sleep/resume:** expiry is re-evaluated from the wall clock on focus,
  visibility, `online` and `pageshow`; hidden-tab timer throttling cannot
  delay or fake it.

## Unsaved-changes protection

`useFormDirty` + `useUnsavedChangesWarning` (`apps/web/src/lib/use-unsaved-changes.ts`)
make the browser confirm reload/close while a form has unsaved input. Applied
to Style, Order Sheet, Job Order creation, Dispatch (Sale) Order and QA
inspection entry. In-app route changes are not intercepted: that needs React
Router's data router (`createBrowserRouter` + `useBlocker`), a routing
migration left as a follow-up.
