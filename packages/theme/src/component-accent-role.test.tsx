/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { IconChip } from "@erve/app-components";
import { EmptyState } from "@erve/app-components";

/**
 * THEME-05/Part 1 regression coverage: IconChip and EmptyState previously
 * used `--erp-color-primary` (the solid-fill-safe token, pinned to the same
 * value in both modes) as FOREGROUND TEXT on `--erp-color-primary-soft`,
 * which measured ~2.67:1 in dark mode — below the 4.5:1 text threshold. The
 * fix reads a dedicated `--erp-text-accent` role instead.
 *
 * jsdom cannot reliably resolve `var(--erp-*)` references against the real
 * theme.css cascade (see the doc comment in portal-scoping.test.tsx), so
 * this asserts the semantic class name directly rather than a computed
 * color — exactly the "prefer semantic/class assertions" guidance from
 * Part 7. The actual contrast ratio is verified by
 * `scripts/check-contrast.mjs`, run separately.
 */
let container: HTMLDivElement;
let root: Root;

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

describe("IconChip", () => {
  it("uses --erp-text-accent (not --erp-color-primary) as foreground text for the 'primary' tone", () => {
    act(() => {
      root.render(<IconChip icon={<span>icon</span>} tone="primary" />);
    });

    const chip = container.querySelector('[data-component="IconChip"]');
    expect(chip).not.toBeNull();
    expect(chip!.className).toContain("text-[var(--erp-text-accent)]");
    expect(chip!.className).not.toContain("text-[var(--erp-color-primary)]");
    // The solid-fill-safe soft background token is unchanged — only the
    // foreground text role changed.
    expect(chip!.className).toContain("bg-[var(--erp-color-primary-soft)]");
  });
});

describe("EmptyState (app-components)", () => {
  it("uses --erp-text-accent (not --erp-color-primary) as foreground text for its icon wrapper", () => {
    act(() => {
      root.render(<EmptyState title="Nothing here" icon={<span>icon</span>} />);
    });

    const iconWrapper = container.querySelector(".bg-\\[var\\(--erp-color-primary-soft\\)\\]");
    expect(iconWrapper).not.toBeNull();
    expect(iconWrapper!.className).toContain("text-[var(--erp-text-accent)]");
    expect(iconWrapper!.className).not.toContain("text-[var(--erp-color-primary)]");
  });
});
