/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PoweredByPinnacle, type PoweredByPinnacleVariant } from "./powered-by-pinnacle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let container: HTMLDivElement;
let root: Root;

function renderBranding(
  logoSrc: string,
  extra: { variant?: PoweredByPinnacleVariant; className?: string } = {},
): void {
  act(() => {
    root.render(<PoweredByPinnacle logoSrc={logoSrc} {...extra} />);
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

describe("PoweredByPinnacle", () => {
  it("row variant (default) shows a visible 'Powered by' label and a decorative logo", () => {
    renderBranding("/pinnacle-logo-on-light.png");
    expect(container.textContent).toContain("Powered by");
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("src")).toBe("/pinnacle-logo-on-light.png");
  });

  it("compact variant shows only the logo, with alt text carrying full meaning", () => {
    renderBranding("/pinnacle-logo-on-dark.png", { variant: "compact" });
    expect(container.textContent).not.toContain("Powered by");
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("alt")).toBe("Powered by Pinnacle Systems");
    expect(img.getAttribute("src")).toBe("/pinnacle-logo-on-dark.png");
  });

  it("swaps the logo src without unmounting the img node when logoSrc changes", () => {
    renderBranding("/pinnacle-logo-on-light.png");
    const firstImg = container.querySelector("img");

    renderBranding("/pinnacle-logo-on-dark.png");
    const secondImg = container.querySelector("img");

    expect(secondImg).toBe(firstImg);
    expect(secondImg?.getAttribute("src")).toBe("/pinnacle-logo-on-dark.png");
  });

  it("has no direct import dependency on @erve/theme", () => {
    const source = readFileSync(path.join(__dirname, "powered-by-pinnacle.tsx"), "utf8");
    expect(source).not.toMatch(/from\s+["']@erve\/theme["']/);
  });
});
