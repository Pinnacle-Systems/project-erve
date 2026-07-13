/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@erve/primitives";

import { ThemeProvider, defaultTheme } from "./index.js";

/**
 * Radix's Popper-based components (DropdownMenu/Tooltip content positioning)
 * call ResizeObserver, which jsdom does not implement. Content is rendered
 * via `open`/`defaultOpen` (no simulated pointer interaction is needed for
 * these tests), so a no-op stub is sufficient.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-density");
  document.documentElement.removeAttribute("data-color-mode");
  document.documentElement.style.cssText = "";
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

/**
 * These assertions deliberately stop at DOM structure and inline-style
 * inheritance rather than asserting fully-resolved theme.css colors:
 * jsdom's CSS engine does not reliably parse Tailwind v4's `@theme`/
 * `@custom-variant` at-rules, so computed-color assertions against the real
 * stylesheet would be brittle (see Part 7's guidance to prefer
 * semantic/structural assertions here). What's actually being verified —
 * that portal content is a true DOM descendant of `document.documentElement`
 * (not scoped to some inner wrapper) and that `<html>` carries the correct
 * global markers — is exactly the thing THEME-08/Part 5 changed, and is
 * fully reliable to assert in jsdom.
 */
describe("Portal scoping — Dialog", () => {
  it("renders dialog content as a DOM descendant of <html>, outside the provider's local container, and sees the global dark marker", () => {
    act(() => {
      root.render(
        <ThemeProvider colorMode="dark">
          <Dialog open>
            <DialogContent aria-describedby={undefined}>
              <DialogTitle>Example dialog</DialogTitle>
            </DialogContent>
          </Dialog>
        </ThemeProvider>,
      );
    });

    expect(document.documentElement.classList.contains("dark")).toBe(true);

    const content = document.body.querySelector('[role="dialog"]');
    expect(content).not.toBeNull();
    expect(container.contains(content)).toBe(false);
    expect(document.body.contains(content)).toBe(true);
    expect(document.documentElement.contains(content)).toBe(true);
  });
});

describe("Portal scoping — DropdownMenu", () => {
  it("renders menu content outside the provider's local container and sees the correct data-theme", () => {
    act(() => {
      root.render(
        <ThemeProvider theme="clientB" colorMode="light">
          <DropdownMenu open>
            <DropdownMenuTrigger>Open</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Item one</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ThemeProvider>,
      );
    });

    expect(document.documentElement.getAttribute("data-theme")).toBe("clientB");

    const content = document.body.querySelector('[role="menu"]');
    expect(content).not.toBeNull();
    expect(container.contains(content)).toBe(false);
    expect(document.body.contains(content)).toBe(true);
  });
});

describe("Portal scoping — Tooltip", () => {
  it("renders tooltip content outside the provider's local container and sees the correct data-color-mode", () => {
    act(() => {
      root.render(
        <ThemeProvider colorMode="dark">
          <TooltipProvider>
            <Tooltip open>
              <TooltipTrigger>Hover me</TooltipTrigger>
              <TooltipContent>Hint text</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </ThemeProvider>,
      );
    });

    expect(document.documentElement.getAttribute("data-color-mode")).toBe("dark");

    const content = document.body.querySelector('[role="tooltip"]');
    expect(content).not.toBeNull();
    expect(container.contains(content)).toBe(false);
    expect(document.body.contains(content)).toBe(true);
  });
});

describe("Portal scoping — custom ThemeTokens object", () => {
  it("reaches portaled dialog content via inherited <html> inline CSS variables", () => {
    const customTheme = {
      ...defaultTheme,
      colors: { ...defaultTheme.colors, accent: "#654321" },
    };

    act(() => {
      root.render(
        <ThemeProvider theme={customTheme} colorMode="light">
          <Dialog open>
            <DialogContent aria-describedby={undefined}>
              <DialogTitle>Custom-themed dialog</DialogTitle>
            </DialogContent>
          </Dialog>
        </ThemeProvider>,
      );
    });

    expect(document.documentElement.style.getPropertyValue("--erp-color-primary")).toBe(
      "#654321",
    );

    const content = document.body.querySelector('[role="dialog"]');
    expect(content).not.toBeNull();
    expect(container.contains(content)).toBe(false);
    // Custom variables are set on <html>, and CSS custom properties inherit
    // by default — since the portal node IS a DOM descendant of <html> (just
    // not of the provider's local React-tree container), it inherits the
    // same computed value even though it renders as a body-level sibling.
    expect(getComputedStyle(content as Element).getPropertyValue("--erp-color-primary")).toBe(
      "#654321",
    );
  });
});
