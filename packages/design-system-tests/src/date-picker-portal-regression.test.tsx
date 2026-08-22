/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DatePicker, Dialog, DialogContent, DialogTitle } from "@erve/primitives";
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
  act(() =>
    root.render(
      <ThemeProvider theme="clientB" density="touch">
        {node}
      </ThemeProvider>,
    ),
  );
  return document.body.querySelector<HTMLButtonElement>(
    '[aria-label="Open date picker calendar"]',
  )!;
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
    act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(document.activeElement).toBe(trigger);
  });

  it("opens from the mobile keyboard shortcut and moves focus into the calendar", async () => {
    renderDatePicker();
    const input = container.querySelector<HTMLInputElement>("#delivery-date")!;
    act(() =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }),
      ),
    );
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

  it("keeps full month names intrinsically sized and uses a narrow-viewport fallback", () => {
    const trigger = renderDatePicker(<DatePicker id="delivery-date" value="2026-09-15" />);
    const popup = openPicker(trigger);
    const month = popup.querySelector<HTMLSelectElement>('select[aria-label="Month"]')!;
    const year = popup.querySelector<HTMLSelectElement>('select[aria-label="Year"]')!;
    const header = month.parentElement!;

    expect([...month.options].map((option) => option.text)).toContain("September");
    expect([...month.options].map((option) => option.text)).toContain("December");
    expect(month.value).toBe("8");
    expect(month.className).toContain("min-w-[7.5rem]");
    expect(month.className).toContain("w-full");
    expect(month.className).toContain("sm:w-max");
    expect(year.className).toContain("min-w-[5rem]");
    expect(header.className).toContain("grid-cols-4");
    expect(header.className).toContain("sm:grid-cols-");
    expect(popup.className).toContain("max-w-[calc(100vw-0.5rem)]");
  });

  it("positions the popup inside narrow viewport gutters", () => {
    vi.stubGlobal("innerWidth", 320);
    const trigger = renderDatePicker();
    trigger.getBoundingClientRect = () => ({
      bottom: 100,
      height: 44,
      left: 300,
      right: 344,
      top: 56,
      width: 44,
      x: 300,
      y: 56,
      toJSON: () => ({}),
    });
    const popup = openPicker(trigger);

    expect(popup.style.left).toBe("4px");
    expect(popup.className).toContain("max-w-[calc(100vw-0.5rem)]");
    expect(popup.querySelector<HTMLElement>('[role="gridcell"]')!.className).toContain("min-w-0");
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
