import { describe, expect, it } from "vitest";

import { isThemeMode, resolveTheme, supportedThemeModes } from "./mode.js";

describe("resolveTheme", () => {
  it.each([
    ["light", false, "light"],
    ["light", true, "light"],
    ["dark", false, "dark"],
    ["dark", true, "dark"],
    ["system", false, "light"],
    ["system", true, "dark"],
  ] as const)(
    "resolves mode=%s, systemPrefersDark=%s -> %s",
    (mode, systemPrefersDark, expected) => {
      expect(resolveTheme(mode, systemPrefersDark)).toBe(expected);
    },
  );

  it("ignores the system value when the mode is explicit light", () => {
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("ignores the system value when the mode is explicit dark", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("follows the supplied system value when mode is system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("isThemeMode", () => {
  it.each(supportedThemeModes)("accepts %s", (mode) => {
    expect(isThemeMode(mode)).toBe(true);
  });

  it.each([
    "blue",
    "Light",
    " light",
    "light ",
    "",
    null,
    undefined,
    0,
    1,
    true,
    false,
    {},
    [],
    ["light"],
    { mode: "light" },
  ])("rejects %j", (value) => {
    expect(isThemeMode(value)).toBe(false);
  });
});
