/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeModeControl, type ThemeModeControlValue } from "./theme-mode-control.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function flushTimers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let container: HTMLDivElement;
let root: Root;

function renderControl(
  value: ThemeModeControlValue,
  onValueChange: (value: ThemeModeControlValue) => void,
  extra: { disabled?: boolean; systemCaption?: string } = {},
): void {
  act(() => {
    root.render(
      <ThemeModeControl value={value} onValueChange={onValueChange} {...extra} />,
    );
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("ThemeModeControl", () => {
  it("renders all three options", () => {
    renderControl("light", vi.fn());
    const radios = container.querySelectorAll('[role="radio"]');
    expect(radios).toHaveLength(3);
  });

  it("marks the current value as selected", () => {
    renderControl("dark", vi.fn());
    const darkRadio = container.querySelector('#theme-mode-dark');
    const lightRadio = container.querySelector('#theme-mode-light');
    expect(darkRadio?.getAttribute("aria-checked")).toBe("true");
    expect(lightRadio?.getAttribute("aria-checked")).toBe("false");
  });

  it("invokes onValueChange with 'dark' when the dark option is selected", () => {
    const onValueChange = vi.fn();
    renderControl("light", onValueChange);

    act(() => {
      (container.querySelector("#theme-mode-dark") as HTMLElement).click();
    });

    expect(onValueChange).toHaveBeenCalledWith("dark");
  });

  it("invokes onValueChange with 'system' when 'Use device setting' is selected", () => {
    const onValueChange = vi.fn();
    renderControl("light", onValueChange);

    act(() => {
      (container.querySelector("#theme-mode-system") as HTMLElement).click();
    });

    expect(onValueChange).toHaveBeenCalledWith("system");
  });

  it("invokes onValueChange with 'light' when the light option is selected", () => {
    const onValueChange = vi.fn();
    renderControl("dark", onValueChange);

    act(() => {
      (container.querySelector("#theme-mode-light") as HTMLElement).click();
    });

    expect(onValueChange).toHaveBeenCalledWith("light");
  });

  it("supports keyboard interaction via the underlying RadioGroup's roving focus", async () => {
    const onValueChange = vi.fn();
    renderControl("light", onValueChange);

    const lightRadio = container.querySelector("#theme-mode-light") as HTMLElement;
    act(() => {
      lightRadio.focus();
    });
    expect(document.activeElement).toBe(lightRadio);

    act(() => {
      lightRadio.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      );
    });
    // Radix's roving-focus group moves focus via an internal `setTimeout`,
    // not synchronously within the keydown handler — flush it before
    // asserting. Selection follows focus per the WAI-ARIA radio group
    // pattern (Radix selects the newly-focused radio automatically).
    await act(async () => {
      await flushTimers();
    });

    expect(onValueChange).toHaveBeenCalledWith("dark");
  });

  it("shows the systemCaption text under the system option", () => {
    renderControl("system", vi.fn(), { systemCaption: "Currently dark" });
    expect(container.textContent).toContain("Currently dark");
  });

  it("renders the disabled state on every option", () => {
    renderControl("light", vi.fn(), { disabled: true });
    const radios = container.querySelectorAll('[role="radio"]');
    radios.forEach((radio) => {
      expect(radio.hasAttribute("disabled") || radio.getAttribute("data-disabled") !== null).toBe(
        true,
      );
    });
  });

  it("has no direct import dependency on @erve/theme", () => {
    const source = readFileSync(path.join(__dirname, "theme-mode-control.tsx"), "utf8");
    // Matches "from '@erve/theme'" / `from "@erve/theme"` specifically, not
    // just any mention of the string (the file's own doc comment explains,
    // in prose, why it deliberately does NOT import it).
    expect(source).not.toMatch(/from\s+["']@erve\/theme["']/);
  });
});
