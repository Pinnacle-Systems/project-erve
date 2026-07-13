/**
 * First-paint theme bootstrap. Runs as a plain, unbundled classic script
 * (see index.html) BEFORE the React module script, so `.dark`/`data-color-mode`
 * /`color-scheme` are already correct on <html> by the time any stylesheet
 * or component paints — this is what prevents an incorrect-theme flash in
 * the Capacitor WebView.
 *
 * This is a deliberate byte-for-byte copy of apps/web/public/theme-init.js
 * (see that file's doc comment for why it can't just import
 * @erve/theme directly). Keep the storage key, valid mode strings,
 * resolution rule, and DOM marker names in this file identical to BOTH the
 * web copy and the canonical logic in @erve/theme
 * (packages/theme/src/{mode,preference,system-preference}.ts) — do not
 * invent a second storage key or marker convention.
 *
 * Only prevents incorrect-theme rendering inside the WebView; it does not
 * control native splash background, native activity background, status
 * bar, or Android navigation bar — those are handled by a separate,
 * later native-surface task.
 */
(function () {
  try {
    var STORAGE_KEY = "erve.themePreference"; // = @erve/theme's THEME_STORAGE_KEY
    var VALID_MODES = ["light", "dark", "system"]; // = @erve/theme's supportedThemeModes

    var stored = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    var mode = VALID_MODES.indexOf(stored) !== -1 ? stored : "system";

    var systemPrefersDark = false;
    try {
      systemPrefersDark = !!(
        window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      );
    } catch {
      systemPrefersDark = false;
    }

    // = @erve/theme's resolveTheme(mode, systemPrefersDark)
    var resolved = mode === "system" ? (systemPrefersDark ? "dark" : "light") : mode;

    var root = document.documentElement;
    root.setAttribute("data-theme", "default");
    root.setAttribute("data-density", "comfortable");
    root.setAttribute("data-color-mode", mode);
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved;
  } catch {
    // Never block first paint on a theme-bootstrap failure.
  }
})();
