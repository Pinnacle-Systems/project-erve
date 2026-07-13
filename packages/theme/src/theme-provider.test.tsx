/** @vitest-environment jsdom */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider, useTheme, defaultTheme, type ThemeContextValue } from "./index.js";
import { THEME_STORAGE_KEY } from "./preference.js";

type ChangeHandler = (event: { matches: boolean }) => void;

class FakeMediaQueryList {
  matches: boolean;
  private listeners = new Set<ChangeHandler>();

  constructor(matches: boolean) {
    this.matches = matches;
  }

  addEventListener(type: "change", listener: ChangeHandler): void {
    if (type === "change") this.listeners.add(listener);
  }

  removeEventListener(type: "change", listener: ChangeHandler): void {
    if (type === "change") this.listeners.delete(listener);
  }

  emit(matches: boolean): void {
    this.matches = matches;
    for (const listener of this.listeners) listener({ matches });
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

function stubMatchMedia(initialMatches = false): FakeMediaQueryList {
  const mql = new FakeMediaQueryList(initialMatches);
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
  return mql;
}

let container: HTMLDivElement;
let root: Root;

function renderInProvider(ui: ReactElement): void {
  act(() => {
    root.render(ui);
  });
}

/** Captures the latest useTheme() value from inside a mounted ThemeProvider. */
function createContextCapture() {
  let latest: ThemeContextValue | undefined;
  const Capture = () => {
    latest = useTheme();
    return null;
  };
  return {
    Capture,
    get value(): ThemeContextValue {
      if (!latest) throw new Error("Capture has not rendered yet");
      return latest;
    },
  };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  window.localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-density");
  document.documentElement.removeAttribute("data-color-mode");

  stubMatchMedia(false);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

describe("ThemeProvider — controlled colorMode", () => {
  it("renders light explicitly, regardless of system preference", () => {
    stubMatchMedia(true); // system prefers dark, but explicit "light" must win
    const capture = createContextCapture();
    renderInProvider(
      <ThemeProvider colorMode="light">
        <capture.Capture />
      </ThemeProvider>,
    );

    expect(capture.value.colorMode).toBe("light");
    expect(capture.value.resolvedTheme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.getAttribute("data-color-mode")).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("renders dark explicitly, regardless of system preference", () => {
    stubMatchMedia(false); // system prefers light, but explicit "dark" must win
    const capture = createContextCapture();
    renderInProvider(
      <ThemeProvider colorMode="dark">
        <capture.Capture />
      </ThemeProvider>,
    );

    expect(capture.value.colorMode).toBe("dark");
    expect(capture.value.resolvedTheme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.getAttribute("data-color-mode")).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("resolves 'system' against the current system preference", () => {
    stubMatchMedia(true);
    const capture = createContextCapture();
    renderInProvider(
      <ThemeProvider colorMode="system">
        <capture.Capture />
      </ThemeProvider>,
    );

    expect(capture.value.colorMode).toBe("system");
    expect(capture.value.resolvedTheme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("does not silently mutate a controlled value when setColorMode is called", () => {
    const capture = createContextCapture();
    renderInProvider(
      <ThemeProvider colorMode="light">
        <capture.Capture />
      </ThemeProvider>,
    );

    act(() => {
      capture.value.setColorMode("dark");
    });

    expect(capture.value.colorMode).toBe("light");
    expect(document.documentElement.getAttribute("data-color-mode")).toBe("light");
  });

  it("only lets system-preference changes affect resolvedTheme when mode is 'system'", () => {
    const mql = stubMatchMedia(false);
    const capture = createContextCapture();
    renderInProvider(
      <ThemeProvider colorMode="light">
        <capture.Capture />
      </ThemeProvider>,
    );

    act(() => {
      mql.emit(true);
    });
    expect(capture.value.resolvedTheme).toBe("light");

    renderInProvider(
      <ThemeProvider colorMode="system">
        <capture.Capture />
      </ThemeProvider>,
    );
    act(() => {
      mql.emit(true);
    });
    expect(capture.value.resolvedTheme).toBe("dark");
  });
});

describe("ThemeProvider — uncontrolled colorMode", () => {
  it("defaults to the stored preference when no colorMode/defaultColorMode is given", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const capture = createContextCapture();
    renderInProvider(
      <ThemeProvider>
        <capture.Capture />
      </ThemeProvider>,
    );

    expect(capture.value.colorMode).toBe("dark");
  });

  it("falls back to 'system' when nothing is stored and no defaultColorMode is given", () => {
    const capture = createContextCapture();
    renderInProvider(
      <ThemeProvider>
        <capture.Capture />
      </ThemeProvider>,
    );

    expect(capture.value.colorMode).toBe("system");
  });

  it("uses defaultColorMode for the initial value when nothing is stored", () => {
    const capture = createContextCapture();
    renderInProvider(
      <ThemeProvider defaultColorMode="dark">
        <capture.Capture />
      </ThemeProvider>,
    );

    expect(capture.value.colorMode).toBe("dark");
  });

  it("prefers defaultColorMode over a stored value for the initial state", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    const capture = createContextCapture();
    renderInProvider(
      <ThemeProvider defaultColorMode="dark">
        <capture.Capture />
      </ThemeProvider>,
    );

    expect(capture.value.colorMode).toBe("dark");
  });

  it("falls back to 'system' when the stored value is invalid", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "blue");
    const capture = createContextCapture();
    renderInProvider(
      <ThemeProvider>
        <capture.Capture />
      </ThemeProvider>,
    );

    expect(capture.value.colorMode).toBe("system");
  });

  it("setColorMode() updates internal state and persists the selection", () => {
    const capture = createContextCapture();
    renderInProvider(
      <ThemeProvider defaultColorMode="light">
        <capture.Capture />
      </ThemeProvider>,
    );

    act(() => {
      capture.value.setColorMode("dark");
    });

    expect(capture.value.colorMode).toBe("dark");
    expect(capture.value.resolvedTheme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});

describe("ThemeProvider — <html> marker application and cleanup", () => {
  it("applies data-theme, data-density, and data-color-mode to <html>", () => {
    renderInProvider(
      <ThemeProvider theme="clientA" density="compact" colorMode="dark">
        <span />
      </ThemeProvider>,
    );

    const root = document.documentElement;
    expect(root.getAttribute("data-theme")).toBe("clientA");
    expect(root.getAttribute("data-density")).toBe("compact");
    expect(root.getAttribute("data-color-mode")).toBe("dark");
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.style.colorScheme).toBe("dark");
  });

  it("updates style.colorScheme immediately on runtime switching", () => {
    const capture = createContextCapture();
    renderInProvider(
      <ThemeProvider defaultColorMode="light">
        <capture.Capture />
      </ThemeProvider>,
    );
    expect(document.documentElement.style.colorScheme).toBe("light");

    act(() => {
      capture.value.setColorMode("dark");
    });
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("preserves an unrelated existing <html> class and cleans up only its own markers on unmount", () => {
    document.documentElement.classList.add("some-other-class");
    document.documentElement.style.colorScheme = "light dark"; // pre-existing unrelated inline value

    act(() => {
      root.render(
        <ThemeProvider colorMode="dark">
          <span />
        </ThemeProvider>,
      );
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("some-other-class")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");

    act(() => {
      root.unmount();
    });

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.classList.contains("some-other-class")).toBe(true);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(document.documentElement.hasAttribute("data-density")).toBe(false);
    expect(document.documentElement.hasAttribute("data-color-mode")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light dark");
  });

  it("warns when more than one ThemeProvider is mounted at once", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const second = document.createElement("div");
    document.body.appendChild(second);
    const secondRoot = createRoot(second);

    act(() => {
      root.render(
        <ThemeProvider colorMode="light">
          <span />
        </ThemeProvider>,
      );
    });
    act(() => {
      secondRoot.render(
        <ThemeProvider colorMode="light">
          <span />
        </ThemeProvider>,
      );
    });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("More than one ThemeProvider"));

    act(() => {
      secondRoot.unmount();
    });
    second.remove();
  });
});

describe("ThemeProvider — custom ThemeTokens objects", () => {
  const customTheme = {
    ...defaultTheme,
    colors: { ...defaultTheme.colors, accent: "#123456" },
  };

  it("applies custom theme CSS variables to <html>", () => {
    renderInProvider(
      <ThemeProvider theme={customTheme} colorMode="light">
        <span />
      </ThemeProvider>,
    );

    expect(document.documentElement.style.getPropertyValue("--erp-color-primary")).toBe(
      "#123456",
    );
  });

  it("reverts custom theme variables (not merely overwrites) after switching back to a predefined theme", () => {
    act(() => {
      root.render(
        <ThemeProvider theme={customTheme} colorMode="light">
          <span />
        </ThemeProvider>,
      );
    });
    expect(document.documentElement.style.getPropertyValue("--erp-color-primary")).toBe(
      "#123456",
    );

    act(() => {
      root.render(
        <ThemeProvider theme="default" colorMode="light">
          <span />
        </ThemeProvider>,
      );
    });

    expect(document.documentElement.style.getPropertyValue("--erp-color-primary")).toBe("");
  });

  it("does not leave stale custom-theme variables on unmount", () => {
    act(() => {
      root.render(
        <ThemeProvider theme={customTheme} colorMode="light">
          <span />
        </ThemeProvider>,
      );
    });
    act(() => {
      root.unmount();
    });

    expect(document.documentElement.style.getPropertyValue("--erp-color-primary")).toBe("");
  });
});
