/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeModeRadioList } from "./theme-mode-radio-list.js";
import { type ThemeModeControlValue } from "./theme-mode-options.js";

let container: HTMLDivElement;
let root: Root;

function renderList(
  value: ThemeModeControlValue,
  onValueChange: (value: ThemeModeControlValue) => void,
  extra: { disabled?: boolean; systemCaption?: string } = {},
): void {
  act(() => {
    root.render(
      <ThemeModeRadioList value={value} onValueChange={onValueChange} {...extra} />,
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

describe("ThemeModeRadioList", () => {
  it("renders all three options inline, with no trigger to open", () => {
    renderList("light", vi.fn());
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(3);
    expect(container.querySelector("button[aria-haspopup]")).toBeNull();
  });

  it("marks the current value as selected", () => {
    renderList("dark", vi.fn());
    const darkRadio = container.querySelector("#theme-mode-dark");
    const lightRadio = container.querySelector("#theme-mode-light");
    expect(darkRadio?.getAttribute("aria-checked")).toBe("true");
    expect(lightRadio?.getAttribute("aria-checked")).toBe("false");
  });

  it("invokes onValueChange with 'dark' when the dark option is selected", () => {
    const onValueChange = vi.fn();
    renderList("light", onValueChange);

    act(() => {
      (container.querySelector("#theme-mode-dark") as HTMLElement).click();
    });

    expect(onValueChange).toHaveBeenCalledWith("dark");
  });

  it("invokes onValueChange with 'system' when 'Use device setting' is selected", () => {
    const onValueChange = vi.fn();
    renderList("light", onValueChange);

    act(() => {
      (container.querySelector("#theme-mode-system") as HTMLElement).click();
    });

    expect(onValueChange).toHaveBeenCalledWith("system");
  });

  it("shows the systemCaption text under the system option without any extra interaction", () => {
    renderList("system", vi.fn(), { systemCaption: "Currently dark" });
    expect(container.textContent).toContain("Currently dark");
  });

  it("renders the disabled state on every option", () => {
    renderList("light", vi.fn(), { disabled: true });
    const radios = container.querySelectorAll('[role="radio"]');
    expect(radios).toHaveLength(3);
    radios.forEach((radio) => {
      expect(radio.hasAttribute("disabled") || radio.getAttribute("data-disabled") !== null).toBe(
        true,
      );
    });
  });

  it("sizes each row to at least a 44px touch target", () => {
    renderList("light", vi.fn());
    const rows = container.querySelectorAll(".min-h-11");
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });
});
