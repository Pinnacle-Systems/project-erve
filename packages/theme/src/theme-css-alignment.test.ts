import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { defaultTheme } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THEME_CSS_PATH = path.join(__dirname, "theme.css");

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractBalancedBlock(css: string, openMarker: string): string {
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

function extractDeclarations(blockText: string): Map<string, string> {
  const declarations = new Map<string, string>();
  const regex = /(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(blockText)) !== null) {
    const [, name, value] = match;
    if (name && value) {
      declarations.set(name, value.trim());
    }
  }
  return declarations;
}

/**
 * This test is the THEME-05/Part 8 "TS/CSS alignment" gate: it exists so
 * that `defaultTheme.colors.accent` (packages/theme/src/index.tsx) can
 * never silently drift from the literal `--erp-color-primary` value in
 * theme.css (or vice versa) — the two representations are hand-authored
 * separately (theme.css's predefined-theme blocks are NOT generated from
 * `getThemeVariables`, see the comment in ThemeProvider), so nothing else
 * in the codebase would catch that divergence.
 */
describe("defaultTheme (TS) vs. theme.css [data-theme=\"default\"] (CSS) — primary family alignment", () => {
  const css = stripComments(readFileSync(THEME_CSS_PATH, "utf8").replace(/\r\n/g, "\n"));
  const lightBlock = extractBalancedBlock(css, '[data-theme="default"] {');
  const cssVars = extractDeclarations(lightBlock);

  it("primary (solid-fill) matches", () => {
    expect(cssVars.get("--erp-color-primary")).toBe(defaultTheme.colors.accent);
  });

  it("primary hover matches", () => {
    expect(cssVars.get("--erp-color-primary-hover")).toBe(defaultTheme.colors.accentHover);
  });

  it("primary active matches", () => {
    expect(cssVars.get("--erp-color-primary-active")).toBe(defaultTheme.colors.accentActive);
  });

  it("primary soft background matches", () => {
    expect(cssVars.get("--erp-color-primary-soft")).toBe(defaultTheme.colors.accentSoft);
  });

  it("primary border matches", () => {
    expect(cssVars.get("--erp-color-primary-border")).toBe(defaultTheme.colors.accentBorder);
  });

  it("primary foreground is white in both representations", () => {
    expect(cssVars.get("--erp-color-primary-foreground")).toBe("#ffffff");
  });

  it("link color matches the hover step (the pre-existing text-link = hover convention)", () => {
    expect(cssVars.get("--erp-text-link")).toBe(defaultTheme.colors.accentHover);
  });

  it("focus border matches the solid-fill primary step", () => {
    expect(cssVars.get("--erp-border-focus")).toBe(defaultTheme.colors.accent);
  });

  it("danger matches (exact-match token sourcing, sanity check)", () => {
    expect(cssVars.get("--erp-color-danger")).toBe(defaultTheme.colors.danger);
  });

  it("info matches (exact-match token sourcing, sanity check)", () => {
    expect(cssVars.get("--erp-color-info")).toBe(defaultTheme.colors.info);
  });
});
