import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getStoredThemePreference,
  setStoredThemePreference,
  THEME_STORAGE_KEY,
} from "./preference.js";

interface MockLocalStorage {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
}

function createStorage(): MockLocalStorage {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

describe("getStoredThemePreference", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns 'system' when nothing is stored", () => {
    vi.stubGlobal("localStorage", createStorage());
    expect(getStoredThemePreference()).toBe("system");
  });

  it.each(["light", "dark", "system"] as const)(
    "returns the stored value '%s' when valid",
    (mode) => {
      const storage = createStorage();
      storage.getItem.mockReturnValue(mode);
      vi.stubGlobal("localStorage", storage);

      expect(getStoredThemePreference()).toBe(mode);
      expect(storage.getItem).toHaveBeenCalledWith(THEME_STORAGE_KEY);
    },
  );

  it("returns 'system' when the stored value is invalid", () => {
    const storage = createStorage();
    storage.getItem.mockReturnValue("blue");
    vi.stubGlobal("localStorage", storage);

    expect(getStoredThemePreference()).toBe("system");
  });

  it("returns 'system' when reading from storage throws", () => {
    const storage = createStorage();
    storage.getItem.mockImplementation(() => {
      throw new Error("SecurityError: storage disabled");
    });
    vi.stubGlobal("localStorage", storage);

    expect(() => getStoredThemePreference()).not.toThrow();
    expect(getStoredThemePreference()).toBe("system");
  });

  it("returns 'system' when localStorage is not defined", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(getStoredThemePreference()).toBe("system");
  });
});

describe("setStoredThemePreference", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(["light", "dark", "system"] as const)(
    "stores '%s' as a plain string",
    (mode) => {
      const storage = createStorage();
      vi.stubGlobal("localStorage", storage);

      setStoredThemePreference(mode);

      expect(storage.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, mode);
    },
  );

  it("round-trips through getStoredThemePreference", () => {
    const storage = createStorage();
    vi.stubGlobal("localStorage", storage);

    setStoredThemePreference("dark");
    expect(getStoredThemePreference()).toBe("dark");
  });

  it("does not throw when storage write fails", () => {
    const storage = createStorage();
    storage.setItem.mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.stubGlobal("localStorage", storage);

    expect(() => setStoredThemePreference("dark")).not.toThrow();
  });

  it("does not throw when localStorage is not defined", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => setStoredThemePreference("dark")).not.toThrow();
  });
});
