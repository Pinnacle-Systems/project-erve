#!/usr/bin/env node
/**
 * THEME-05/Part 6 gate: fails if the default light block defines a
 * color-bearing `--erp-*` custom property that the `.dark` block doesn't
 * account for (either by declaring it directly, or by being explicitly
 * allowlisted as intentionally-inherited/mode-independent).
 *
 * Dependency-free — reads packages/theme/src/theme.css directly and does a
 * small amount of brace-balanced text extraction. Not a full CSS parser;
 * this file's structure (flat custom-property declarations, no nested
 * rules inside the blocks we scan) is simple enough that it doesn't need
 * one.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THEME_CSS_PATH = path.join(__dirname, "..", "src", "theme.css");

const REQUIRED_PREFIXES = [
  "--erp-color-",
  "--erp-surface-",
  "--erp-text-",
  "--erp-border-",
  "--erp-status-",
  "--erp-validation-",
  "--erp-state-",
  "--erp-grid-",
  "--erp-form-",
  "--erp-shell-",
  "--erp-chart-",
  "--erp-focus-",
];

/**
 * Legacy bare-alias names (e.g. `--erp-accent`, `--erp-bg`) that don't
 * match any prefix above (no trailing dash + suffix) but are still real,
 * actively-referenced color variables (see theme.css's `--erp-grid-row-
 * hover-accent: var(--erp-accent)`). Enforced in addition to the prefix
 * list, not instead of it.
 */
const REQUIRED_EXACT_NAMES = new Set([
  "--erp-bg",
  "--erp-fg",
  "--erp-surface",
  "--erp-surface-muted",
  "--erp-border",
  "--erp-border-strong",
  "--erp-muted",
  "--erp-subtle",
  "--erp-accent",
  "--erp-accent-hover",
  "--erp-accent-active",
  "--erp-accent-soft",
  "--erp-accent-border",
  "--erp-danger",
  "--erp-danger-hover",
  "--erp-danger-soft",
  "--erp-danger-border",
  "--erp-warning",
  "--erp-warning-soft",
  "--erp-warning-border",
  "--erp-success",
  "--erp-success-soft",
  "--erp-success-border",
  "--erp-info",
  "--erp-info-soft",
  "--erp-info-border",
]);

/**
 * Variables that intentionally have NO direct `.dark` declaration because
 * their light-mode value is itself a `var(--erp-*)` reference to another
 * variable that IS overridden in `.dark` — the reference resolves to the
 * correct dark value automatically via CSS cascade, so redeclaring it
 * would be redundant. Each entry must be documented with why.
 */
const INHERITED_REFERENCE_ALLOWLIST = new Map([
  [
    "--erp-grid-row-hover-accent",
    "value is `var(--erp-accent)`; --erp-accent is overridden in .dark, so this resolves correctly without a direct override",
  ],
  [
    "--erp-text-accent",
    "value is `var(--erp-text-link)`; --erp-text-link is overridden in .dark, so this resolves correctly without a direct override",
  ],
]);

/** Dimension/non-color units that disqualify an otherwise-matching-prefix
 * declaration from being treated as "color-bearing". */
const NON_COLOR_VALUE_PATTERN =
  /^-?\d+(\.\d+)?(px|rem|em|%|ms|s|vh|vw)?$|max-content|fit-content|cubic-bezier|^none$|^inherit$|Inter|SFMono|Consolas|Menlo|Liberation/i;

function isColorValue(value) {
  const v = value.trim();
  if (
    /^#[0-9a-fA-F]{3,8}$/.test(v) ||
    /^rgba?\(/.test(v) ||
    /^hsla?\(/.test(v) ||
    /^color-mix\(/.test(v) ||
    v === "transparent" ||
    v === "currentColor" ||
    (/^var\(--color-/.test(v) ) || // Tailwind palette reference (e.g. var(--color-rose-400))
    (/^var\(--erp-/.test(v) && !NON_COLOR_VALUE_PATTERN.test(v))
  ) {
    return true;
  }
  return false;
}

function extractBalancedBlock(css, openMarker) {
  const startIdx = css.indexOf(openMarker);
  if (startIdx === -1) {
    throw new Error(`Could not locate marker: ${openMarker}`);
  }
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

function isRequiredName(name) {
  if (REQUIRED_EXACT_NAMES.has(name)) return true;
  return REQUIRED_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function stripComments(css) {
  // Comments can contain text that looks like a declaration (e.g. this
  // script's own doc comments reference `--erp-grid-row-hover-accent: var(...)`
  // in prose) — strip them before parsing, or a comment can be mistaken for
  // a real declaration and swallow the next real one as its "value".
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function main() {
  const css = stripComments(readFileSync(THEME_CSS_PATH, "utf8").replace(/\r\n/g, "\n"));

  const lightBlock = extractBalancedBlock(css, '[data-theme="default"] {');
  const darkBlock = extractBalancedBlock(css, '.dark,\n.dark [data-theme="default"],');

  const lightDeclarations = extractDeclarations(lightBlock);
  const darkNames = new Set(extractDeclarations(darkBlock).keys());

  const requiredColorNames = [...lightDeclarations.entries()]
    .filter(([name, value]) => isRequiredName(name) && isColorValue(value))
    .map(([name]) => name);

  const missing = requiredColorNames.filter(
    (name) => !darkNames.has(name) && !INHERITED_REFERENCE_ALLOWLIST.has(name),
  );

  const allowlistedCount = requiredColorNames.filter((name) =>
    INHERITED_REFERENCE_ALLOWLIST.has(name),
  ).length;

  console.log(
    `Checked ${requiredColorNames.length} color-bearing variable(s) in the default light block.`,
  );
  console.log(`  ${requiredColorNames.length - missing.length - allowlistedCount} directly overridden in .dark`);
  console.log(`  ${allowlistedCount} allowlisted (inherited via var() reference):`);
  for (const [name, reason] of INHERITED_REFERENCE_ALLOWLIST) {
    if (requiredColorNames.includes(name)) {
      console.log(`    - ${name}: ${reason}`);
    }
  }

  if (missing.length > 0) {
    console.error(
      `\nFAIL: ${missing.length} color variable(s) are defined in the default light block but missing from .dark and not allowlisted:\n`,
    );
    for (const name of missing) {
      console.error(`  ${name}: ${lightDeclarations.get(name)}`);
    }
    console.error(
      "\nAdd a .dark override for each, or add it to INHERITED_REFERENCE_ALLOWLIST in this script with a documented reason.",
    );
    process.exit(1);
  }

  console.log("\nPASS: every required color-bearing variable has a .dark override or a documented allowlist entry.");
}

main();
