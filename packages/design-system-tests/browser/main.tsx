import { useEffect } from "react";
import { createRoot } from "react-dom/client";
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
import "./styles.css";

const density = (new URLSearchParams(location.search).get("density") ?? "compact") as Density;

function Harness() {
  useEffect(() => {
    document.querySelector<HTMLButtonElement>('[aria-label="Open date picker calendar"]')?.click();
    let cancelled = false;
    const measure = async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (cancelled) return;

      const rect = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`Missing geometry target: ${selector}`);
        const box = element.getBoundingClientRect();
        return { width: box.width, height: box.height, fontSize: getComputedStyle(element).fontSize };
      };
      const measurements = {
        viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth },
        density: document.documentElement.dataset.density,
        checkbox: rect('[data-test="checkbox"]'),
        radio: rect('[data-test="radio"]'),
        switch: rect('[data-test="switch"]'),
        dateTrigger: rect('[aria-label="Open date picker calendar"]'),
        dateNavigation: rect('[aria-label="Next month"]'),
        dateMonth: rect('select[aria-label="Month"]'),
        dateYear: rect('select[aria-label="Year"]'),
        dateDay: rect('[role="gridcell"]:not(:disabled)'),
        dateClear: rect('[aria-label="Clear selected date"]'),
        selectOption: rect('[data-test="select-option"]'),
        dropdownItem: rect('[data-test="dropdown-item"]'),
        gridCell: rect('[data-test="grid-cell"]'),
        paginationNext: rect('[aria-label="Go to next page"]'),
        paginationSelect: rect('select[aria-label="Rows per page"]'),
        filterSearch: rect('[data-test="filter-bar"] input[aria-label="Search"]'),
        filterSelect: rect('[data-test="filter-bar"] button[role="combobox"]'),
      };

      const interactive = density === "touch"
        ? Object.entries(measurements).filter(([key]) => !["viewport", "density"].includes(key))
        : [];
      const failures = interactive.flatMap(([key, value]) => {
        const box = value as { width: number; height: number };
        return box.height < 44 || (["checkbox", "radio", "switch", "dateTrigger", "dateNavigation", "dateDay", "paginationNext"].includes(key) && box.width < 44)
          ? [`${key}=${box.width}x${box.height}`]
          : [];
      });
      if (density === "compact") {
        const expected32 = ["dateNavigation", "dateMonth", "dateYear", "dateDay", "selectOption", "dropdownItem", "paginationNext", "paginationSelect", "filterSearch", "filterSelect"];
        for (const key of expected32) {
          const height = (measurements[key as keyof typeof measurements] as { height: number }).height;
          if (height !== 32) failures.push(`${key}.height=${height}`);
        }
        if (measurements.dateTrigger.height !== 28) failures.push(`dateTrigger.height=${measurements.dateTrigger.height}`);
        if (measurements.gridCell.height !== 24) failures.push(`gridCell.height=${measurements.gridCell.height}`);
      }
      if (measurements.viewport.scrollWidth > measurements.viewport.width) {
        failures.push(`horizontalOverflow=${measurements.viewport.scrollWidth - measurements.viewport.width}`);
      }

      const result = document.createElement("pre");
      result.id = "geometry-result";
      result.dataset.status = failures.length ? "fail" : "pass";
      result.textContent = JSON.stringify({ measurements, failures });
      document.body.appendChild(result);
    };
    void measure().catch((error) => {
      const result = document.createElement("pre");
      result.id = "geometry-result";
      result.dataset.status = "fail";
      result.textContent = JSON.stringify({ failures: [String(error)] });
      document.body.appendChild(result);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-2 p-2">
      <Checkbox data-test="checkbox" aria-label="Checkbox" />
      <RadioGroup defaultValue="one"><Radio data-test="radio" aria-label="Radio" value="one" /></RadioGroup>
      <Switch data-test="switch" aria-label="Switch" />
      <DatePicker id="geometry-date" />
      <SelectField open value="one" aria-label="Select"><SelectItem data-test="select-option" value="one">One</SelectItem></SelectField>
      <DropdownMenu open><DropdownMenuTrigger>Menu</DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem data-test="dropdown-item">One</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      <GridCellInput data-test="grid-cell" aria-label="Grid cell" />
      <Pagination page={1} pageSize={10} total={30} onPageChange={() => {}} onPageSizeChange={() => {}} />
      <div data-test="filter-bar"><FilterBar className="[&]:border-0" statusOptions={[{ label: "Open", value: "open" }]} onStatusChange={() => {}} /></div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<ThemeProvider density={density}><Harness /></ThemeProvider>);
