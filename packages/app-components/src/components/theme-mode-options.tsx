import { type ReactElement, type SVGProps } from "react";

/**
 * Mirrors `@erve/theme`'s `ThemeMode` by convention, not by import.
 * Design-system packages below `@erve/theme` in the dependency graph
 * intentionally have no package dependency on it — they consume `--erp-*`
 * CSS variables only. Connected wrappers (e.g. each app's theme/ThemeModeMenu.tsx)
 * import the real type and bind it to `useTheme()`.
 */
export type ThemeModeControlValue = "light" | "dark" | "system";

export interface ThemeModeOption {
  value: ThemeModeControlValue;
  label: string;
  Icon: (props: SVGProps<SVGSVGElement>) => ReactElement;
}

function SunIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </svg>
  );
}

function SystemIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" />
    </svg>
  );
}

export const THEME_MODE_OPTIONS: ReadonlyArray<ThemeModeOption> = [
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
  { value: "system", label: "Use device setting", Icon: SystemIcon },
];

export const THEME_MODE_LABEL_BY_VALUE: Record<ThemeModeControlValue, string> = Object.fromEntries(
  THEME_MODE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<ThemeModeControlValue, string>;

export const THEME_MODE_ICON_BY_VALUE: Record<ThemeModeControlValue, ThemeModeOption["Icon"]> =
  Object.fromEntries(
    THEME_MODE_OPTIONS.map((option) => [option.value, option.Icon]),
  ) as Record<ThemeModeControlValue, ThemeModeOption["Icon"]>;
