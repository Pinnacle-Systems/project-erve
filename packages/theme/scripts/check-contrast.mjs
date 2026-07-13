#!/usr/bin/env node
/**
 * THEME-05/Part 7 gate: computes WCAG contrast ratios for the semantic
 * token pairs that matter most for readability/accessibility, for both
 * the light (default) and dark themes, and fails the build if any
 * required pair is below its threshold.
 *
 * Dependency-free — reads packages/theme/src/theme.css directly, resolves
 * `--erp-*` custom-property values (including `var()` references to other
 * `--erp-*` variables and to a small set of Tailwind's auto-generated
 * `--color-*` palette variables), composites translucent colors over a
 * documented backdrop, and applies the standard WCAG relative-luminance
 * contrast formula. Not a full CSS engine — this file's declarations are
 * simple enough (flat custom properties, no shorthand color syntax beyond
 * hex/rgb()/var()) that a small hand-rolled resolver is sufficient.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THEME_CSS_PATH = path.join(__dirname, "..", "src", "theme.css");

/**
 * Tailwind v4 auto-generates a `--color-{name}-{step}` custom property for
 * every color in its default palette once `@import "tailwindcss"` runs.
 * theme.css references a handful of these directly (e.g.
 * `var(--color-rose-400)`) instead of hardcoding hex, matching Tailwind's
 * own documented default palette. These are treated as known constants
 * here since resolving them by actually running Tailwind's build is out
 * of scope for a dependency-free script — see the final report for this
 * caveat.
 */
const TAILWIND_COLOR_LOOKUP = {
  "rose-400": "#fb7185",
  "rose-900": "#881337",
  "emerald-400": "#34d399",
  "sky-400": "#38bdf8",
  "amber-400": "#fbbf24",
  "indigo-400": "#818cf8",
};

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractBalancedBlock(css, openMarker) {
  const startIdx = css.indexOf(openMarker);
  if (startIdx === -1) throw new Error(`Could not locate marker: ${openMarker}`);
  const braceStart = css.indexOf("{", startIdx);
  let depth = 0;
  let i = braceStart;
  for (; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return css.slice(braceStart + 1, i);
}

function extractDeclarations(blockText) {
  const declarations = new Map();
  const regex = /(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let match;
  while ((match = regex.exec(blockText)) !== null) {
    declarations.set(match[1], match[2].trim());
  }
  return declarations;
}

// ---- Color parsing / resolution -------------------------------------------

function hexToRgba(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

function rgbFunctionToRgba(value) {
  // Handles both CSS Color 4 space syntax `rgb(r g b / a)` and the
  // legacy comma syntax `rgba(r, g, b, a)` — both appear conceptually
  // possible here even though this file only actually uses the space
  // syntax.
  const inner = value.slice(value.indexOf("(") + 1, value.lastIndexOf(")"));
  const [channelsPart, alphaPart] = inner.split("/");
  const nums = channelsPart
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  const [r, g, b] = nums;
  let a = 1;
  if (alphaPart !== undefined) {
    a = parseFloat(alphaPart.trim());
  } else if (nums.length === 4) {
    a = nums[3];
  }
  return { r, g, b, a };
}

/**
 * Resolves a variable name to a final {r,g,b,a} color, following
 * `var(--erp-*)` references within `map` and `var(--color-*)` references
 * via TAILWIND_COLOR_LOOKUP. Returns null for values this script doesn't
 * understand (e.g. `color-mix()`, `currentColor`) — callers must handle
 * that case (none of the required pairs below resolve to one).
 */
function resolveVarToRgba(name, map, visited = new Set()) {
  if (visited.has(name)) throw new Error(`Cycle detected resolving ${name}`);
  visited.add(name);
  const value = map.get(name);
  if (value === undefined) {
    throw new Error(`Variable ${name} is not declared in this block/mode`);
  }
  return resolveValueToRgba(value, map, visited);
}

function resolveValueToRgba(value, map, visited) {
  const v = value.trim();
  if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return hexToRgba(v);
  if (/^rgba?\(/.test(v)) return rgbFunctionToRgba(v);

  const erpRef = v.match(/^var\(\s*(--erp-[a-zA-Z0-9-]+)\s*\)$/);
  if (erpRef) return resolveVarToRgba(erpRef[1], map, visited);

  const tailwindRef = v.match(/^var\(\s*--color-([a-zA-Z]+-\d+)\s*\)$/);
  if (tailwindRef) {
    const hex = TAILWIND_COLOR_LOOKUP[tailwindRef[1]];
    if (!hex) throw new Error(`No known hex for Tailwind color var(--color-${tailwindRef[1]})`);
    return hexToRgba(hex);
  }

  return null;
}

function compositeOverBackdrop(fg, backdropRgb) {
  if (fg.a >= 1) return { r: fg.r, g: fg.g, b: fg.b };
  return {
    r: fg.r * fg.a + backdropRgb.r * (1 - fg.a),
    g: fg.g * fg.a + backdropRgb.g * (1 - fg.a),
    b: fg.b * fg.a + backdropRgb.b * (1 - fg.a),
  };
}

function relativeLuminance({ r, g, b }) {
  const chan = (c) => {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

function contrastRatio(rgb1, rgb2) {
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---- Required pairs ---------------------------------------------------

/**
 * Backdrop used when compositing a translucent background color for
 * contrast purposes. Status/soft backgrounds in this theme are designed
 * to render on a card/panel surface, so `--erp-color-surface` is used as
 * the representative backdrop in both modes (matches the manual
 * verification done while choosing these values — see the final report).
 */
const BACKDROP_VAR = "--erp-color-surface";

function statusPair(label, family, hasForegroundRole) {
  const pairs = [
    {
      label: `${label}: status text on status background`,
      fg: `--erp-status-${family}-fg`,
      bg: `--erp-status-${family}-bg`,
      threshold: 4.5,
    },
  ];
  if (hasForegroundRole) {
    pairs.push({
      label: `${label}: white foreground on solid status background`,
      fg: `--erp-status-${family}-foreground`,
      bg: `--erp-status-${family}`,
      threshold: 4.5,
    });
  }
  return pairs;
}

const REQUIRED_PAIRS = [
  {
    label: "Primary foreground on primary solid",
    fg: "--erp-color-primary-foreground",
    bg: "--erp-color-primary",
    threshold: 4.5,
  },
  {
    label: "Primary/link foreground on page background",
    fg: "--erp-text-link",
    bg: "--erp-color-page-bg",
    threshold: 4.5,
  },
  {
    label: "Primary/link foreground on raised surface",
    fg: "--erp-text-link",
    bg: "--erp-color-surface-raised",
    threshold: 4.5,
  },
  {
    label: "Primary border/focus against surrounding surface",
    fg: "--erp-border-focus",
    bg: "--erp-color-surface",
    threshold: 3,
  },
  {
    // Was "Primary text on soft primary background" (fg: --erp-color-primary),
    // reported as a WARN with a documented ~2.67:1 dark-mode failure:
    // --erp-color-primary is pinned to the solid-button-safe step (600,
    // #c21530) in BOTH modes for button/checked-control contrast, but
    // icon-chip.tsx and EmptyState's "primary" tone were reading that same
    // variable as foreground TEXT on --erp-color-primary-soft. Fixed by
    // introducing --erp-text-accent (a dedicated foreground-text role) and
    // updating both components to use it instead — this pair now checks
    // the actual rendered combination and must PASS, not warn.
    label: "Accent foreground text on soft primary background (IconChip/EmptyState)",
    fg: "--erp-text-accent",
    bg: "--erp-color-primary-soft",
    threshold: 4.5,
  },
  {
    // Found during THEME-06 dark-mode visual verification: Tooltip's
    // content previously hardcoded Tailwind's `text-primary-foreground`
    // (`--erp-color-primary-foreground`, a fixed #ffffff in both modes) as
    // its text color against `--erp-surface-inverse`, which is *designed*
    // to flip per mode (dark bubble in light mode, light bubble in dark
    // mode) — in dark mode that produced near-white text on a near-white
    // bubble. Fixed by switching Tooltip to `--erp-text-inverse`, which
    // flips in lockstep with `--erp-surface-inverse`; this pair checks the
    // actual rendered combination.
    label: "Inverse foreground text on inverse surface (Tooltip)",
    fg: "--erp-text-inverse",
    bg: "--erp-surface-inverse",
    threshold: 4.5,
  },
  ...statusPair("Draft", "draft", true),
  ...statusPair("Submitted", "submitted", true),
  ...statusPair("Approved", "approved", true),
  ...statusPair("Rejected", "rejected", true),
  ...statusPair("Posted", "posted", true),
  ...statusPair("Cancelled", "cancelled", true),
  ...statusPair("Pending", "pending", false),
  ...statusPair("Warning", "warning", false),
  ...statusPair("Success", "success", false),
  ...statusPair("Danger", "danger", false),
  ...statusPair("Info", "info", false),
];

/**
 * Deliberately excluded from automated checking (documented, not silently
 * omitted — see Part 7 instructions):
 * - `--erp-focus-ring` / `--erp-state-focus` / `--erp-grid-cell-focus-ring`:
 *   translucent glow effects layered ON TOP OF `--erp-border-focus` (which
 *   IS tested above as the primary focus-visibility signal); the glow's
 *   own alpha-blended contrast against arbitrary underlying content isn't
 *   a meaningful single number to gate on.
 * - Hover/active/pressed states: interaction-dependent, not captured by a
 *   static token pair; flagged for manual/visual review instead (see the
 *   accompanying implementation report's testing-strategy section).
 * - Dialog overlay contrast: a translucent full-screen scrim over
 *   arbitrary page content has no single meaningful backdrop to composite
 *   against; requires visual review.
 */

function formatRgb({ r, g, b }) {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

function checkMode(modeName, resolvedMap) {
  console.log(`\n=== ${modeName} ===`);
  const backdrop = resolveVarToRgba(BACKDROP_VAR, resolvedMap);
  let failures = 0;

  for (const pair of REQUIRED_PAIRS) {
    let fgRgba, bgRgba;
    try {
      fgRgba = resolveVarToRgba(pair.fg, resolvedMap);
      bgRgba = resolveVarToRgba(pair.bg, resolvedMap);
    } catch (err) {
      // An unresolved required color (undeclared variable, circular
      // reference, or a value this script's resolver doesn't understand)
      // must fail the gate, not be silently skipped — otherwise a typo'd
      // or deleted variable would pass the check by accident.
      failures++;
      console.log(`  FAIL  ${pair.label} (${pair.fg} vs ${pair.bg}): unresolved — ${err.message}`);
      continue;
    }

    const fgRgb = compositeOverBackdrop(fgRgba, backdrop);
    const bgRgb = compositeOverBackdrop(bgRgba, backdrop);
    const ratio = contrastRatio(fgRgb, bgRgb);
    const pass = ratio >= pair.threshold;
    const resolvedNote = `[${pair.fg} -> ${formatRgb(fgRgb)}] on [${pair.bg} -> ${formatRgb(bgRgb)}]`;

    if (pair.knownGap) {
      // Supported for future non-blocking exploratory checks, but no
      // REQUIRED_PAIRS entry currently uses this — every pair above is a
      // real rendered combination and must actually pass, not warn.
      const status = pass ? "PASS" : "WARN";
      console.log(
        `  ${status}  ${pair.label} ${resolvedNote}: ` +
          `${ratio.toFixed(2)}:1 (required >= ${pair.threshold}:1)` +
          (pass ? "" : ` — KNOWN GAP: ${pair.knownGap}`),
      );
      continue;
    }

    if (!pass) failures++;
    console.log(
      `  ${pass ? "PASS" : "FAIL"}  ${pair.label} ${resolvedNote}: ` +
        `${ratio.toFixed(2)}:1 (required >= ${pair.threshold}:1)`,
    );
  }

  return failures;
}

function main() {
  const rawCss = readFileSync(THEME_CSS_PATH, "utf8").replace(/\r\n/g, "\n");
  const css = stripComments(rawCss);

  const lightBlock = extractBalancedBlock(css, '[data-theme="default"] {');
  const darkBlock = extractBalancedBlock(css, '.dark,\n.dark [data-theme="default"],');

  const lightMap = extractDeclarations(lightBlock);
  const darkOverrides = extractDeclarations(darkBlock);
  // Dark mode's *effective* value for any variable not redeclared in
  // .dark is whatever :root/[data-theme="default"] set — this mirrors
  // real CSS cascade behavior, not just the literal .dark block content.
  const darkMap = new Map([...lightMap, ...darkOverrides]);

  const lightFailures = checkMode("Light theme", lightMap);
  const darkFailures = checkMode("Dark theme", darkMap);

  const totalFailures = lightFailures + darkFailures;
  console.log(
    `\n${totalFailures === 0 ? "PASS" : "FAIL"}: ${totalFailures} failing pair(s) across both modes.`,
  );
  if (totalFailures > 0) process.exit(1);
}

main();
