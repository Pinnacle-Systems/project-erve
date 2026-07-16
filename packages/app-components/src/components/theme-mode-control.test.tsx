/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeModeControl, type ThemeModeControlValue } from "./theme-mode-control.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** DropdownMenu positions itself via Radix Popper, which calls
 * ResizeObserver — unimplemented in jsdom. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
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

// Radix's DropdownMenuTrigger opens on `pointerdown`, not `click` — a plain
// `.click()` (a synthetic "click" event only) never triggers it in jsdom.
function firePointerDown(element: HTMLElement): void {
  element.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }),
  );
}

function openMenu(): void {
  act(() => {
    firePointerDown(container.querySelector("button") as HTMLElement);
  });
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ThemeModeControl", () => {
  it("renders a single trigger button labeled with the active mode", () => {
    renderControl("dark", vi.fn());
    const trigger = container.querySelector("button") as HTMLElement;
    expect(trigger).not.toBeNull();
    expect(trigger.getAttribute("aria-label")).toBe("Theme: Dark");
  });

  it("opens a menu with all three options on click", () => {
    renderControl("light", vi.fn());
    openMenu();

    const options = document.body.querySelectorAll('[role="menuitemradio"]');
    expect(options).toHaveLength(3);
  });

  it("marks the current value as checked", () => {
    renderControl("dark", vi.fn());
    openMenu();

    const darkOption = document.body.querySelector("#theme-mode-dark");
    const lightOption = document.body.querySelector("#theme-mode-light");
    expect(darkOption?.getAttribute("aria-checked")).toBe("true");
    expect(lightOption?.getAttribute("aria-checked")).toBe("false");
  });

  it("invokes onValueChange with 'dark' when the dark option is selected", () => {
    const onValueChange = vi.fn();
    renderControl("light", onValueChange);
    openMenu();

    act(() => {
      (document.body.querySelector("#theme-mode-dark") as HTMLElement).click();
    });

    expect(onValueChange).toHaveBeenCalledWith("dark");
  });

  it("invokes onValueChange with 'system' when 'Use device setting' is selected", () => {
    const onValueChange = vi.fn();
    renderControl("light", onValueChange);
    openMenu();

    act(() => {
      (document.body.querySelector("#theme-mode-system") as HTMLElement).click();
    });

    expect(onValueChange).toHaveBeenCalledWith("system");
  });

  it("invokes onValueChange with 'light' when the light option is selected", () => {
    const onValueChange = vi.fn();
    renderControl("dark", onValueChange);
    openMenu();

    act(() => {
      (document.body.querySelector("#theme-mode-light") as HTMLElement).click();
    });

    expect(onValueChange).toHaveBeenCalledWith("light");
  });

  it("shows the systemCaption text under the system option, inside the menu only", () => {
    renderControl("system", vi.fn(), { systemCaption: "Currently dark" });
    expect(container.textContent).not.toContain("Currently dark");

    openMenu();
    expect(document.body.textContent).toContain("Currently dark");
  });

  it("disables the trigger when disabled is set", () => {
    renderControl("light", vi.fn(), { disabled: true });
    const trigger = container.querySelector("button") as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
  });

  it("has no direct import dependency on @erve/theme", () => {
    const source = readFileSync(path.join(__dirname, "theme-mode-control.tsx"), "utf8");
    // Matches "from '@erve/theme'" / `from "@erve/theme"` specifically, not
    // just any mention of the string (the file's own doc comment explains,
    // in prose, why it deliberately does NOT import it).
    expect(source).not.toMatch(/from\s+["']@erve\/theme["']/);
  });
});
