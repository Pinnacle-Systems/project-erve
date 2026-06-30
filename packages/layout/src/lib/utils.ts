import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const customTwMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": ["text-control", "text-label", "text-data"],
      rounded: ["rounded-control", "rounded-card", "rounded-panel", "rounded-pill"],
      shadow: ["shadow-control", "shadow-card", "shadow-panel", "shadow-popover", "shadow-focus"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return customTwMerge(clsx(inputs));
}
