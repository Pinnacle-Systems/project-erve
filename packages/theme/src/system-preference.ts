/**
 * Thin, independently-testable wrapper around
 * `window.matchMedia("(prefers-color-scheme: dark)")`.
 *
 * Deliberately has no React dependency (it's called from ThemeProvider, but
 * also from any pre-hydration/native bridge code that runs before React
 * mounts) and never touches `window`/`matchMedia` at module-import time —
 * every access happens inside a function call, guarded by a `typeof` check,
 * so importing this module is safe in Node/SSR/Capacitor-bridge contexts
 * where those globals don't exist.
 */

const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export type SystemPreferenceListener = (prefersDark: boolean) => void;

/** Subset of MediaQueryList this module actually relies on, plus the legacy
 * addListener/removeListener pair some older WebViews still only support. */
interface CompatibleMediaQueryList {
  matches: boolean;
  addEventListener?: (
    type: "change",
    listener: (event: { matches: boolean }) => void,
  ) => void;
  removeEventListener?: (
    type: "change",
    listener: (event: { matches: boolean }) => void,
  ) => void;
  addListener?: (listener: (event: { matches: boolean }) => void) => void;
  removeListener?: (listener: (event: { matches: boolean }) => void) => void;
}

function getDarkMediaQueryList(): CompatibleMediaQueryList | undefined {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return undefined;
  }
  return window.matchMedia(DARK_MEDIA_QUERY);
}

/**
 * Current system preference. Returns `false` (i.e. resolves "system" to
 * light) whenever the preference can't be determined — missing `window`,
 * missing `matchMedia`, or any other unsupported environment. Never throws
 * solely because a browser API is unavailable.
 */
export function getSystemPrefersDark(): boolean {
  return getDarkMediaQueryList()?.matches ?? false;
}

/**
 * Subscribes to system-preference changes. Always returns a cleanup
 * function, even when no subscription could be established (missing
 * `window`/`matchMedia`, or a MediaQueryList that supports neither the
 * modern nor the legacy listener API) — callers can call it unconditionally
 * without checking whether the subscription "really" happened.
 */
export function subscribeToSystemPreference(
  listener: SystemPreferenceListener,
): () => void {
  const mediaQueryList = getDarkMediaQueryList();
  if (!mediaQueryList) {
    return () => {};
  }

  const handleChange = (event: { matches: boolean }): void => {
    listener(event.matches);
  };

  if (typeof mediaQueryList.addEventListener === "function") {
    mediaQueryList.addEventListener("change", handleChange);
    return () => mediaQueryList.removeEventListener?.("change", handleChange);
  }

  // Legacy fallback (older WebKit/Safari) — only used when the modern
  // addEventListener API isn't present on the returned MediaQueryList.
  if (typeof mediaQueryList.addListener === "function") {
    mediaQueryList.addListener(handleChange);
    return () => mediaQueryList.removeListener?.(handleChange);
  }

  return () => {};
}
