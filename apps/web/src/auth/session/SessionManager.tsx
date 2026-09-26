import { useEffect, useRef, useState } from 'react';
import {
  configureSessionActivitySource,
  getSessionTiming,
  refreshAccessToken,
  reloadSessionTimingFromStorage,
  SESSION_TIMING_STORAGE_KEY,
  SessionLifecycle,
  subscribeSessionTiming,
  type SessionPhase,
} from '@erve/client';
import { useAuth } from '../AuthContext.js';
import { AbsoluteExpiryWarningDialog, IdleWarningDialog, ReauthDialog } from './SessionDialogs.js';

/**
 * Interactions that count as the user genuinely working. Listened to in the
 * capture phase on window so non-bubbling events (element scroll) and events
 * whose propagation a component stops are still seen. Pointer movement alone
 * is deliberately excluded. Processing is throttled in SessionLifecycle.
 */
export const ACTIVITY_EVENTS = [
  'keydown',
  'input',
  'change',
  'pointerdown',
  'click',
  'touchstart',
  'wheel',
  'scroll',
] as const;

/** Events after which timing is re-checked against the wall clock (sleep/resume, reconnect). */
const RESUME_EVENTS = ['focus', 'online', 'pageshow'] as const;

function isTabVisible(): boolean {
  return document.visibilityState === 'visible';
}

function reachedAbsoluteLimit(): boolean {
  const timing = getSessionTiming();
  return Boolean(timing && Date.now() + timing.clockOffsetMs >= timing.absoluteExpiresAt);
}

/**
 * Keeps an actively used session alive silently, warns before idle expiry,
 * and handles expiry by signing in again over the current page. Renders
 * nothing while the session is healthy.
 */
export function SessionManager() {
  const { status, user, login, logout } = useAuth();
  const [phase, setPhase] = useState<SessionPhase>({ kind: 'active' });
  const [dismissedAbsoluteWarning, setDismissedAbsoluteWarning] = useState<number | null>(null);
  const lifecycleRef = useRef<SessionLifecycle | null>(null);
  const active = status === 'authenticated';
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!active || !userId) return;

    const lifecycle = new SessionLifecycle({
      // Timing persisted by a tab signed in as someone else is not ours;
      // without timing the first activity fetches it (and a refresh that
      // reveals another user resets this tab).
      getTiming: () => {
        const timing = getSessionTiming();
        return timing?.userId === userId ? timing : null;
      },
      subscribeTiming: (listener) => subscribeSessionTiming(() => listener()),
      renew: (activity) => refreshAccessToken({ activity }),
      onPhaseChange: setPhase,
      isVisible: isTabVisible,
    });
    lifecycleRef.current = lifecycle;
    configureSessionActivitySource(() => lifecycle.hasPendingActivity());

    const onActivity = () => lifecycle.recordActivity();
    const onResume = () => lifecycle.check();
    const onVisibility = () => {
      if (isTabVisible()) lifecycle.check();
    };
    const listenerOptions = { capture: true, passive: true } as const;

    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, onActivity, listenerOptions);
    for (const type of RESUME_EVENTS) window.addEventListener(type, onResume);
    document.addEventListener('visibilitychange', onVisibility);
    lifecycle.start();

    return () => {
      for (const type of ACTIVITY_EVENTS) {
        window.removeEventListener(type, onActivity, listenerOptions);
      }
      for (const type of RESUME_EVENTS) window.removeEventListener(type, onResume);
      document.removeEventListener('visibilitychange', onVisibility);
      lifecycle.stop();
      configureSessionActivitySource(null);
      lifecycleRef.current = null;
      setPhase({ kind: 'active' });
    };
  }, [active, userId]);

  // Another tab renewed or signed in: pick up the new timing it stored.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === SESSION_TIMING_STORAGE_KEY) reloadSessionTimingFromStorage();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  if (status === 'reauth-required' && user) {
    return (
      <ReauthDialog
        user={user}
        reachedAbsoluteLimit={reachedAbsoluteLimit()}
        onSignedIn={(response) => login(response.accessToken, response.user, response.session)}
        onSignOut={() => void logout()}
      />
    );
  }

  if (!active) return null;

  if (phase.kind === 'idle-warning') {
    return (
      <IdleWarningDialog
        expiresAt={phase.expiresAt}
        onContinue={async () => {
          await lifecycleRef.current?.continueSession();
        }}
        onSignOut={() => void logout()}
      />
    );
  }

  if (phase.kind === 'absolute-warning' && dismissedAbsoluteWarning !== phase.expiresAt) {
    return (
      <AbsoluteExpiryWarningDialog
        expiresAt={phase.expiresAt}
        onDismiss={() => setDismissedAbsoluteWarning(phase.expiresAt)}
      />
    );
  }

  return null;
}
