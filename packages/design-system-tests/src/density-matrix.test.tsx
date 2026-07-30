/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FilterBar } from "@erve/app-components";
import { Pagination } from "@erve/data-display";
import {
  Checkbox,
  DatePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  GridCellInput,
  Radio,
  RadioGroup,
  SelectField,
  SelectItem,
  Switch,
} from "@erve/primitives";
import { ThemeProvider, type Density } from "@erve/theme";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.querySelectorAll("[data-radix-popper-content-wrapper]").forEach((node) => node.remove());
  vi.unstubAllGlobals();
});

function renderAtDensity(density: Density, node: React.ReactNode) {
  act(() => root.render(<ThemeProvider density={density}>{node}</ThemeProvider>));
}

describe.each([
  ["compact", "h-3.5", "h-4", "h-(--erp-grid-cell-height)"],
  ["comfortable", "h-4", "h-5", "h-(--erp-grid-cell-height)"],
  ["touch", "h-11", "h-11", "min-h-11"],
] as const)("%s density primitives", (density, checkboxHeight, switchHeight, gridHeight) => {
  it("resolves ambient density for effective targets without scaling indicators", () => {
    renderAtDensity(
      density,
      <>
        <Checkbox id="terms" label="Terms" />
        <RadioGroup defaultValue="one"><Radio id="one" value="one" label="One" /></RadioGroup>
        <Switch id="alerts" label="Alerts" />
        <GridCellInput aria-label="Quantity" />
      </>,
    );

    const checkbox = container.querySelector<HTMLElement>('[role="checkbox"]')!;
    const radio = container.querySelector<HTMLElement>('[role="radio"]')!;
    const switchControl = container.querySelector<HTMLElement>('[role="switch"]')!;
    const grid = container.querySelector<HTMLElement>('input[aria-label="Quantity"]')!;

    expect(checkbox.dataset.density).toBe(density);
    expect(checkbox.className).toContain(checkboxHeight);
    expect(radio.dataset.density).toBe(density);
    expect(radio.className).toContain(checkboxHeight);
    expect(switchControl.dataset.density).toBe(density);
    expect(switchControl.className).toContain(switchHeight);
    expect(grid.dataset.density).toBe(density);
    expect(grid.className).toContain(gridHeight);

    if (density === "touch") {
      expect(checkbox.querySelector("span")!.className).toContain("h-5");
      expect(radio.querySelector("span")!.className).toContain("h-5");
      expect(switchControl.querySelector("span")!.className).toContain("h-6");
    }
  });
});

describe("compound density precedence and portals", () => {
  it("propagates a RadioGroup override to its items", () => {
    renderAtDensity("touch", <RadioGroup density="compact"><Radio value="one" label="One" /></RadioGroup>);
    expect(container.querySelector<HTMLElement>('[role="radio"]')!.dataset.density).toBe("compact");
  });

  it("propagates a SelectField override through its real portal", () => {
    renderAtDensity(
      "touch",
      <SelectField density="compact" open value="one" aria-label="Example">
        <SelectItem value="one">One</SelectItem>
      </SelectField>,
    );
    const option = document.body.querySelector<HTMLElement>('[role="option"]')!;
    expect(container.contains(option)).toBe(false);
    expect(option.dataset.density).toBe("compact");
    expect(option.className).toContain("min-h-8");
    expect(option.className).toContain("text-sm");
  });

  it("propagates a DropdownMenuContent override through its real portal", () => {
    renderAtDensity(
      "touch",
      <DropdownMenu open>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent density="compact"><DropdownMenuItem>One</DropdownMenuItem></DropdownMenuContent>
      </DropdownMenu>,
    );
    const item = document.body.querySelector<HTMLElement>('[role="menuitem"]')!;
    expect(container.contains(item)).toBe(false);
    expect(item.dataset.density).toBe("compact");
    expect(item.className).toContain("min-h-8");
  });

  it("portals DatePicker content and applies touch targets to every popup control", () => {
    renderAtDensity("touch", <DatePicker id="delivery" />);
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Open date picker calendar"]')!;
    act(() => trigger.click());

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.dataset.density).toBe("touch");
    expect(trigger.className).toContain("h-11");
    for (const control of dialog.querySelectorAll<HTMLElement>("button, select")) {
      expect(control.className).toContain("min-h-11");
    }
    expect(dialog.querySelector<HTMLElement>('[role="gridcell"]')!.className).toContain("w-11");
  });
});

describe("Pagination and FilterBar", () => {
  it.each([
    ["compact", "min-h-8"],
    ["comfortable", "min-h-9"],
    ["touch", "min-h-11"],
  ] as const)("uses ambient %s density", (density, expectedHeight) => {
    renderAtDensity(
      density,
      <>
        <Pagination page={1} pageSize={10} total={30} onPageChange={() => {}} onPageSizeChange={() => {}} />
        <FilterBar statusOptions={[{ label: "Open", value: "open" }]} onStatusChange={() => {}} hasActiveFilters onClearFilters={() => {}} />
      </>,
    );

    const pagination = container.querySelector<HTMLElement>(`div[data-density="${density}"]`)!;
    expect(pagination.querySelector<HTMLButtonElement>('button[aria-label="Go to next page"]')!.className).toContain(expectedHeight);
    expect(pagination.querySelector<HTMLSelectElement>('select[aria-label="Rows per page"]')!.className).toContain(expectedHeight);
    const filterBar = Array.from(container.querySelectorAll<HTMLElement>(`div[data-density="${density}"]`)).at(-1)!;
    expect(filterBar.querySelector<HTMLInputElement>('input[aria-label="Search"]')!.className).toContain(density === "compact" ? "h-8" : density === "comfortable" ? "h-control" : "h-11");
  });

  it("honors explicit compact overrides inside a touch application", () => {
    renderAtDensity("touch", <Pagination density="compact" page={1} pageSize={10} total={30} onPageChange={() => {}} />);
    expect(container.firstElementChild!.getAttribute("data-density")).toBe("compact");
  });
});

describe("interaction semantics", () => {
  it("activates a touch checkbox from anywhere in its associated label", () => {
    renderAtDensity("touch", <Checkbox id="accept" label="Accept terms" />);
    const checkbox = container.querySelector<HTMLElement>('[role="checkbox"]')!;
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    act(() => container.querySelector("label")!.click());
    expect(checkbox.getAttribute("aria-checked")).toBe("true");
  });
});
