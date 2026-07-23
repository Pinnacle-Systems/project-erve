/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, "..", "..", "public", "theme-init.js");
const scriptText = readFileSync(SCRIPT_PATH, "utf8");

const STORAGE_KEY = "erve.themePreference";

/** Executes the exact deployed script text in this test's jsdom global scope. */
function runScript(): void {
  new Function(scriptText)();
}

function stubMatchMedia(matches: boolean): void {
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches }) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-density");
  document.documentElement.removeAttribute("data-color-mode");
  document.documentElement.style.cssText = "";
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("theme-init.js (first-paint bootstrap)", () => {
  it("applies dark for a stored 'dark' preference", () => {
    window.localStorage.setItem(STORAGE_KEY, "dark");
    stubMatchMedia(false);

    runScript();

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.getAttribute("data-color-mode")).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("applies light for a stored 'light' preference", () => {
    window.localStorage.setItem(STORAGE_KEY, "light");
    stubMatchMedia(true);

    runScript();

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.getAttribute("data-color-mode")).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("resolves stored 'system' against a dark system preference", () => {
    window.localStorage.setItem(STORAGE_KEY, "system");
    stubMatchMedia(true);

    runScript();

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.getAttribute("data-color-mode")).toBe("system");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("resolves stored 'system' against a light system preference", () => {
    window.localStorage.setItem(STORAGE_KEY, "system");
    stubMatchMedia(false);

    runScript();

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.getAttribute("data-color-mode")).toBe("system");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("falls back to 'system' when nothing is stored", () => {
    stubMatchMedia(true);

    runScript();

    expect(document.documentElement.getAttribute("data-color-mode")).toBe("system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("falls back to 'system' when the stored preference is invalid", () => {
    window.localStorage.setItem(STORAGE_KEY, "blue");
    stubMatchMedia(false);

    runScript();

    expect(document.documentElement.getAttribute("data-color-mode")).toBe("system");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("falls back to 'system' and never throws when reading storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: storage disabled");
    });
    stubMatchMedia(true);

    expect(() => runScript()).not.toThrow();
    expect(document.documentElement.getAttribute("data-color-mode")).toBe("system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("falls back to light and never throws when matchMedia is unavailable", () => {
    const original = window.matchMedia;
    // @ts-expect-error deliberately simulating an environment without matchMedia
    delete window.matchMedia;

    expect(() => runScript()).not.toThrow();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");

    window.matchMedia = original;
  });

  it("always sets data-theme=default and data-density=compact", () => {
    runScript();

    expect(document.documentElement.getAttribute("data-theme")).toBe("default");
    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
  });
});
