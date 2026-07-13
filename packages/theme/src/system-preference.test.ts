import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getSystemPrefersDark,
  subscribeToSystemPreference,
} from "./system-preference.js";

type ChangeHandler = (event: { matches: boolean }) => void;

class FakeModernMediaQueryList {
  matches: boolean;
  private listeners = new Set<ChangeHandler>();

  constructor(matches: boolean) {
    this.matches = matches;
  }

  addEventListener(type: "change", listener: ChangeHandler): void {
    if (type === "change") {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: "change", listener: ChangeHandler): void {
    if (type === "change") {
      this.listeners.delete(listener);
    }
  }

  emit(matches: boolean): void {
    this.matches = matches;
    for (const listener of this.listeners) {
      listener({ matches });
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

class FakeLegacyMediaQueryList {
  matches: boolean;
  private listeners = new Set<ChangeHandler>();

  constructor(matches: boolean) {
    this.matches = matches;
  }

  addListener(listener: ChangeHandler): void {
    this.listeners.add(listener);
  }

  removeListener(listener: ChangeHandler): void {
    this.listeners.delete(listener);
  }

  emit(matches: boolean): void {
    this.matches = matches;
    for (const listener of this.listeners) {
      listener({ matches });
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

function stubWindowWithMatchMedia(mql: unknown): void {
  vi.stubGlobal("window", {
    matchMedia: vi.fn().mockReturnValue(mql),
  });
}

describe("getSystemPrefersDark", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns the current matchMedia().matches value", () => {
    stubWindowWithMatchMedia(new FakeModernMediaQueryList(true));
    expect(getSystemPrefersDark()).toBe(true);

    stubWindowWithMatchMedia(new FakeModernMediaQueryList(false));
    expect(getSystemPrefersDark()).toBe(false);
  });

  it("returns false when window is not defined", () => {
    vi.stubGlobal("window", undefined);
    expect(getSystemPrefersDark()).toBe(false);
  });

  it("returns false when window.matchMedia is not a function", () => {
    vi.stubGlobal("window", {});
    expect(getSystemPrefersDark()).toBe(false);
  });

  it("does not throw when browser globals are unavailable", () => {
    vi.stubGlobal("window", undefined);
    expect(() => getSystemPrefersDark()).not.toThrow();
  });
});

describe("subscribeToSystemPreference", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("notifies the listener with updated values via addEventListener", () => {
    const mql = new FakeModernMediaQueryList(false);
    stubWindowWithMatchMedia(mql);

    const listener = vi.fn();
    subscribeToSystemPreference(listener);

    mql.emit(true);
    expect(listener).toHaveBeenCalledWith(true);

    mql.emit(false);
    expect(listener).toHaveBeenCalledWith(false);
  });

  it("returns a cleanup function that removes the modern listener", () => {
    const mql = new FakeModernMediaQueryList(false);
    stubWindowWithMatchMedia(mql);

    const listener = vi.fn();
    const unsubscribe = subscribeToSystemPreference(listener);
    expect(mql.listenerCount).toBe(1);

    unsubscribe();
    expect(mql.listenerCount).toBe(0);

    mql.emit(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it("falls back to the legacy addListener/removeListener API", () => {
    const mql = new FakeLegacyMediaQueryList(false);
    stubWindowWithMatchMedia(mql);

    const listener = vi.fn();
    const unsubscribe = subscribeToSystemPreference(listener);
    expect(mql.listenerCount).toBe(1);

    mql.emit(true);
    expect(listener).toHaveBeenCalledWith(true);

    unsubscribe();
    expect(mql.listenerCount).toBe(0);
  });

  it("returns a no-op cleanup function when window is not defined", () => {
    vi.stubGlobal("window", undefined);
    const unsubscribe = subscribeToSystemPreference(vi.fn());
    expect(() => unsubscribe()).not.toThrow();
  });

  it("returns a no-op cleanup function when matchMedia is not a function", () => {
    vi.stubGlobal("window", {});
    const unsubscribe = subscribeToSystemPreference(vi.fn());
    expect(() => unsubscribe()).not.toThrow();
  });
});
