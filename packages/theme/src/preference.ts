import { isThemeMode, type ThemeMode } from "./mode.js";

/**
 * Separate from `packages/client/src/token-storage.ts` (auth token) on
 * purpose — theme preference is not an auth concern and must not share a
 * key or a module with it.
 */
export const THEME_STORAGE_KEY = "erve.themePreference";

const DEFAULT_THEME_MODE: ThemeMode = "system";

function readRawValue(): string | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // Storage can throw (private browsing, disabled storage, etc.) —
    // treat exactly like "no stored value".
    return null;
  }
}

/**
 * Always returns a valid ThemeMode. Falls back to "system" (never "light")
 * when nothing is stored, the stored value is invalid, or storage itself
 * isn't accessible.
 */
export function getStoredThemePreference(): ThemeMode {
  const raw = readRawValue();
  return isThemeMode(raw) ? raw : DEFAULT_THEME_MODE;
}

/**
 * Best-effort write. A storage failure (quota exceeded, disabled storage,
 * etc.) must not crash the caller — theme preference persistence is a nice
 * to have, not a requirement for the app to function.
 */
export function setStoredThemePreference(mode: ThemeMode): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Best-effort — see doc comment above.
  }
}

export { isThemeMode };
