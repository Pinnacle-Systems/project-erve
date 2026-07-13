/**
 * First-paint theme bootstrap. Runs as a plain, unbundled classic script
 * (see index.html) BEFORE the React module script, so `.dark`/`data-color-mode`
 * /`color-scheme` are already correct on <html> by the time any stylesheet
 * or component paints — this is what prevents an incorrect-theme flash.
 *
 * This is a deliberate, small duplication of the canonical logic in
 * @erve/theme (packages/theme/src/{mode,preference,system-preference}.ts) —
 * that package can't run here because it's part of the bundled React app.
 * Keep the storage key, valid mode strings, resolution rule, and DOM marker
 * names in this file byte-for-byte in sync with that package; do not invent
 * a second storage key or marker convention.
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
