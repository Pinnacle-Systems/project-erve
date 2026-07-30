/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DatePicker,
  Dialog,
  DialogContent,
  DialogTitle,
} from "@erve/primitives";
import { ThemeProvider } from "@erve/theme";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    return window.setTimeout(() => callback(0), 0);
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.documentElement.removeAttribute("dir");
  vi.unstubAllGlobals();
});

function renderDatePicker(node = <DatePicker id="delivery-date" />) {
  act(() => root.render(<ThemeProvider theme="clientB" density="touch">{node}</ThemeProvider>));
  return document.body.querySelector<HTMLButtonElement>('[aria-label="Open date picker calendar"]')!;
}

function openPicker(trigger: HTMLButtonElement) {
  act(() => trigger.click());
  return document.getElementById(trigger.getAttribute("aria-controls")!)!;
}

describe("DatePicker portal lifecycle", () => {
  it("escapes clipping containers and inherits global theme, density, and direction markers", () => {
    document.documentElement.dir = "rtl";
    const trigger = renderDatePicker(
      <div data-test="clip-container" style={{ overflow: "hidden", height: 20 }}>
        <DatePicker id="delivery-date" />
      </div>,
    );
    const popup = openPicker(trigger);

    expect(container.contains(popup)).toBe(false);
    expect(document.documentElement.contains(popup)).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("clientB");
    expect(document.documentElement.dataset.density).toBe("touch");
    expect(document.documentElement.dir).toBe("rtl");
    expect(popup.dataset.density).toBe("touch");
  });

  it("dismisses on outside pointer interaction", () => {
    const trigger = renderDatePicker();
    openPicker(trigger);
    act(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("dismisses on Escape and restores focus to the calendar trigger", async () => {
    const trigger = renderDatePicker();
    openPicker(trigger);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(document.activeElement).toBe(trigger);
  });

  it("opens from the mobile keyboard shortcut and moves focus into the calendar", async () => {
    renderDatePicker();
    const input = container.querySelector<HTMLInputElement>("#delivery-date")!;
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true })));
    const popup = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(popup).not.toBeNull();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(document.activeElement?.getAttribute("role")).toBe("gridcell");
  });

  it("repositions while an ancestor scrolls", () => {
    const trigger = renderDatePicker();
    let bottom = 100;
    trigger.getBoundingClientRect = () => ({
      bottom,
      height: 44,
      left: 20,
      right: 64,
      top: bottom - 44,
      width: 44,
      x: 20,
      y: bottom - 44,
      toJSON: () => ({}),
    });
    const popup = openPicker(trigger);
    expect(popup.style.top).toBe("104px");

    bottom = 180;
    act(() => window.dispatchEvent(new Event("scroll")));
    expect(popup.style.top).toBe("184px");
  });

  it("renders above an open modal dialog without becoming aria-hidden", () => {
    const trigger = renderDatePicker(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Schedule</DialogTitle>
          <DatePicker id="dialog-date" />
        </DialogContent>
      </Dialog>,
    );
    const popup = openPicker(trigger);
    const dialogContent = document.body.querySelectorAll<HTMLElement>('[role="dialog"]')[0]!;

    expect(popup).not.toBe(dialogContent);
    expect(popup.className).toContain("z-50");
    expect(popup.getAttribute("aria-hidden")).not.toBe("true");
    expect(popup.hasAttribute("data-aria-hidden")).toBe(false);
  });
});
