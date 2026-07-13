/**
 * Theme mode is platform-neutral: it must be usable from both the web app
 * and the Capacitor mobile app without any DOM/React dependency.
 */
export type ThemeMode = "light" | "dark" | "system";

/**
 * The mode actually applied to the UI once "system" has been resolved
 * against the device/browser's current appearance preference.
 */
export type ResolvedTheme = "light" | "dark";

export const supportedThemeModes = [
  "light",
  "dark",
  "system",
] as const satisfies readonly ThemeMode[];

export function isThemeMode(value: unknown): value is ThemeMode {
  return (
    typeof value === "string" &&
    (supportedThemeModes as readonly string[]).includes(value)
  );
}

/**
 * Pure resolution: "light"/"dark" are explicit selections and always win;
 * "system" defers to the caller-supplied system preference. No browser or
 * React dependency, so this is safe to call from anywhere (including before
 * hydration or from a native bridge) and to unit test in isolation.
 */
export function resolveTheme(
  mode: ThemeMode,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (mode === "system") {
    return systemPrefersDark ? "dark" : "light";
  }
  return mode;
}
