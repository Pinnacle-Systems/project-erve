/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

import { DatePicker } from "@erve/primitives";
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
  vi.unstubAllGlobals();
});

function typeIntoInput(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    input.focus();
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function blurInput(input: HTMLInputElement) {
  act(() => {
    input.blur();
    input.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

function openCalendar(trigger: HTMLButtonElement) {
  act(() => trigger.click());
  return document.getElementById(trigger.getAttribute("aria-controls")!)!;
}

describe("DatePicker — typed date behavior and canonical contract", () => {
  it("commits a valid typed date in DD/MM/YYYY format to canonical YYYY-MM-DD", () => {
    let committedValue: string | undefined = "INITIAL";
    act(() => {
      root.render(
        <ThemeProvider theme="default" density="comfortable">
          <DatePicker
            id="test-date"
            label="Order Date"
            onValueChange={(val) => {
              committedValue = val;
            }}
          />
        </ThemeProvider>,
      );
    });

    const input = container.querySelector<HTMLInputElement>("#test-date")!;
    typeIntoInput(input, "15/09/2026");
    blurInput(input);

    expect(committedValue).toBe("2026-09-15");
    expect(input.value).toBe("15/09/2026");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("commits an ISO formatted typed date (YYYY-MM-DD) and normalizes display on blur", () => {
    let committedValue: string | undefined;
    act(() => {
      root.render(
        <ThemeProvider theme="default" density="comfortable">
          <DatePicker
            id="test-date"
            onValueChange={(val) => {
              committedValue = val;
            }}
          />
        </ThemeProvider>,
      );
    });

    const input = container.querySelector<HTMLInputElement>("#test-date")!;
    typeIntoInput(input, "2026-09-15");
    expect(committedValue).toBe("2026-09-15");

    blurInput(input);
    expect(input.value).toBe("15/09/2026");
  });

  it("handles partial input gracefully without clearing draft or emitting fake values", () => {
    let committedValue: string | undefined = undefined;
    act(() => {
      root.render(
        <ThemeProvider theme="default" density="comfortable">
          <DatePicker
            id="test-date"
            onValueChange={(val) => {
              committedValue = val;
            }}
          />
        </ThemeProvider>,
      );
    });

    const input = container.querySelector<HTMLInputElement>("#test-date")!;
    typeIntoInput(input, "15/0");
    // User is still typing: no error yet, no fake date committed
    expect(input.value).toBe("15/0");
    expect(committedValue).toBeUndefined();
    expect(container.querySelector('[role="alert"]')).toBeNull();

    // Now user finishes typing
    typeIntoInput(input, "15/09/2026");
    expect(committedValue).toBe("2026-09-15");
  });

  it("rejects impossible dates (e.g. 31/02/2026) without silently rolling over to March", () => {
    let committedValue: string | undefined = "PREVIOUS";
    act(() => {
      root.render(
        <ThemeProvider theme="default" density="comfortable">
          <DatePicker
            id="test-date"
            onValueChange={(val) => {
              committedValue = val;
            }}
          />
        </ThemeProvider>,
      );
    });

    const input = container.querySelector<HTMLInputElement>("#test-date")!;
    typeIntoInput(input, "31/02/2026");
    blurInput(input);

    expect(committedValue).toBeUndefined(); // Invalid does not commit
    expect(input.value).toBe("31/02/2026"); // User text preserved for correction
    expect(container.textContent).toContain("Enter a valid date in DD/MM/YYYY format.");
  });

  it("accepts Feb 29 on leap years and rejects Feb 29 on non-leap years", () => {
    let committedValue: string | undefined;
    act(() => {
      root.render(
        <ThemeProvider theme="default" density="comfortable">
          <DatePicker
            id="test-date"
            onValueChange={(val) => {
              committedValue = val;
            }}
          />
        </ThemeProvider>,
      );
    });

    const input = container.querySelector<HTMLInputElement>("#test-date")!;

    // Non-leap year 2026
    typeIntoInput(input, "29/02/2026");
    blurInput(input);
    expect(committedValue).toBeUndefined();
    expect(container.textContent).toContain("Enter a valid date in DD/MM/YYYY format.");

    // Leap year 2024
    typeIntoInput(input, "29/02/2024");
    blurInput(input);
    expect(committedValue).toBe("2024-02-29");
    expect(container.textContent).not.toContain("Enter a valid date");
  });

  it("handles malformed input by retaining draft and showing clear validation", () => {
    let committedValue: string | undefined = "PREVIOUS";
    act(() => {
      root.render(
        <ThemeProvider theme="default" density="comfortable">
          <DatePicker
            id="test-date"
            onValueChange={(val) => {
              committedValue = val;
            }}
          />
        </ThemeProvider>,
      );
    });

    const input = container.querySelector<HTMLInputElement>("#test-date")!;
    typeIntoInput(input, "invalid-text");
    blurInput(input);

    expect(committedValue).toBeUndefined();
    expect(input.value).toBe("invalid-text");
    expect(container.textContent).toContain("Enter a valid date in DD/MM/YYYY format.");
  });

  it("allows clearing an optional date and resets canonical value", () => {
    let committedValue: string | undefined = "2026-09-15";
    function Wrapper() {
      const [val, setVal] = useState<string | undefined>("2026-09-15");
      return (
        <ThemeProvider theme="default" density="comfortable">
          <DatePicker
            id="test-date"
            value={val}
            onValueChange={(next) => {
              committedValue = next;
              setVal(next);
            }}
          />
        </ThemeProvider>
      );
    }
    act(() => {
      root.render(<Wrapper />);
    });

    const input = container.querySelector<HTMLInputElement>("#test-date")!;
    expect(input.value).toBe("15/09/2026");

    typeIntoInput(input, "");
    blurInput(input);

    expect(committedValue).toBeUndefined();
    expect(input.value).toBe("");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("DatePicker — calendar selection and popover", () => {
  it("commits selected calendar date to canonical format and updates input", () => {
    let committedValue: string | undefined;
    act(() => {
      root.render(
        <ThemeProvider theme="default" density="comfortable">
          <DatePicker
            id="test-date"
            value="2026-09-15"
            onValueChange={(val) => {
              committedValue = val;
            }}
          />
        </ThemeProvider>,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open date picker calendar"]',
    )!;
    const popup = openCalendar(trigger);

    // Find and click the 20th day button in September
    const dayButtons = Array.from(popup.querySelectorAll<HTMLButtonElement>('[role="gridcell"]:not([disabled])'));
    const day20 = dayButtons.find((btn) => btn.textContent?.trim() === "20")!;
    act(() => day20.click());

    expect(committedValue).toBe("2026-09-20");
    const input = container.querySelector<HTMLInputElement>("#test-date")!;
    expect(input.value).toBe("20/09/2026");
  });

  it("clears date via the popover Clear action", () => {
    let committedValue: string | undefined = "2026-09-15";
    act(() => {
      root.render(
        <ThemeProvider theme="default" density="comfortable">
          <DatePicker
            id="test-date"
            value="2026-09-15"
            onValueChange={(val) => {
              committedValue = val;
            }}
          />
        </ThemeProvider>,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open date picker calendar"]',
    )!;
    const popup = openCalendar(trigger);
    const clearButton = popup.querySelector<HTMLButtonElement>(
      'button[aria-label="Clear selected date"]',
    )!;
    act(() => clearButton.click());

    expect(committedValue).toBeUndefined();
    const input = container.querySelector<HTMLInputElement>("#test-date")!;
    expect(input.value).toBe("");
  });
});

describe("DatePicker — min and max boundary constraints", () => {
  it("enforces min date boundary for both typing and calendar selection", () => {
    let committedValue: string | undefined;
    act(() => {
      root.render(
        <ThemeProvider theme="default" density="comfortable">
          <DatePicker
            id="test-date"
            min="2026-04-01"
            onValueChange={(val) => {
              committedValue = val;
            }}
          />
        </ThemeProvider>,
      );
    });

    const input = container.querySelector<HTMLInputElement>("#test-date")!;

    // Type date before min
    typeIntoInput(input, "31/03/2026");
    blurInput(input);
    expect(committedValue).toBeUndefined();
    expect(container.textContent).toContain("Date is outside the allowed range.");

    // Type date at min
    typeIntoInput(input, "01/04/2026");
    blurInput(input);
    expect(committedValue).toBe("2026-04-01");
    expect(container.textContent).not.toContain("Date is outside the allowed range.");
  });

  it("enforces max date boundary for typing", () => {
    let committedValue: string | undefined;
    act(() => {
      root.render(
        <ThemeProvider theme="default" density="comfortable">
          <DatePicker
            id="test-date"
            max="2026-04-30"
            onValueChange={(val) => {
              committedValue = val;
            }}
          />
        </ThemeProvider>,
      );
    });

    const input = container.querySelector<HTMLInputElement>("#test-date")!;

    // Type date after max
    typeIntoInput(input, "01/05/2026");
    blurInput(input);
    expect(committedValue).toBeUndefined();
    expect(container.textContent).toContain("Date is outside the allowed range.");

    // Type date at max
    typeIntoInput(input, "30/04/2026");
    blurInput(input);
    expect(committedValue).toBe("2026-04-30");
  });
});

describe("DatePicker — controlled hydration and accessibility", () => {
  it("hydrates from initial canonical YYYY-MM-DD and updates on prop change", () => {
    function ControlledTest() {
      const [currentDate, setCurrentDate] = useState("2026-04-01");
      return (
        <ThemeProvider theme="default" density="comfortable">
          <DatePicker id="test-date" value={currentDate} onValueChange={(val) => setCurrentDate(val ?? "")} />
          <button type="button" onClick={() => setCurrentDate("2026-12-31")}>
            Update Date
          </button>
        </ThemeProvider>
      );
    }

    act(() => {
      root.render(<ControlledTest />);
    });

    const input = container.querySelector<HTMLInputElement>("#test-date")!;
    expect(input.value).toBe("01/04/2026");

    const updateBtn = container.querySelector<HTMLButtonElement>("button:not([aria-label])")!;
    act(() => updateBtn.click());
    expect(input.value).toBe("31/12/2026");
  });

  it("supports keyboard navigation: calendar trigger is reachable and accessible", () => {
    act(() => {
      root.render(
        <ThemeProvider theme="default" density="comfortable">
          <DatePicker id="test-date" label="Delivery Date" required />
        </ThemeProvider>,
      );
    });

    const input = container.querySelector<HTMLInputElement>("#test-date")!;
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open date picker calendar"]',
    )!;

    expect(input.getAttribute("placeholder")).toBe("DD/MM/YYYY");
    expect(input.getAttribute("required")).toBe("");
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("label")?.textContent).toContain("Delivery Date");
    expect(container.querySelector("label")?.textContent).toContain("*");
  });
});
