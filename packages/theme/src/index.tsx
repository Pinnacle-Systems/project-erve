import {
  createContext,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { colorTokens, crimsonTokens } from "@erve/tokens";

import {
  resolveTheme,
  supportedThemeModes,
  type ResolvedTheme,
  type ThemeMode,
} from "./mode.js";
import {
  getSystemPrefersDark,
  subscribeToSystemPreference,
} from "./system-preference.js";
import {
  getStoredThemePreference,
  setStoredThemePreference,
} from "./preference.js";

export type { ThemeMode, ResolvedTheme } from "./mode.js";
export { isThemeMode, resolveTheme, supportedThemeModes } from "./mode.js";
export {
  getSystemPrefersDark,
  subscribeToSystemPreference,
  type SystemPreferenceListener,
} from "./system-preference.js";
export {
  getStoredThemePreference,
  setStoredThemePreference,
  THEME_STORAGE_KEY,
} from "./preference.js";

export type ThemeName = "default" | "clientA" | "clientB";
export type Density = "compact" | "comfortable" | "touch";
/**
 * Kept as the historical name for the theme-mode type. `ThemeMode` (from
 * `./mode.js`) is now the platform-neutral canonical definition; `ColorMode`
 * is an alias so every existing `@erve/theme` import keeps compiling
 * unchanged.
 */
export type ColorMode = ThemeMode;

export type ThemeTokens = {
  name: ThemeName;
  fontFamilySans: string;
  fontFamilyMono: string;
  colors: {
    appBg: string;
    pageBg: string;
    bg: string;
    fg: string;
    fgMuted: string;
    fgSubtle: string;
    fgInverse: string;
    surface: string;
    surfaceMuted: string;
    surfaceRaised: string;
    surfaceAccent: string;
    rowHoverBg: string;
    border: string;
    borderMuted: string;
    borderStrong: string;
    muted: string;
    subtle: string;
    accent: string;
    accentHover: string;
    accentActive: string;
    accentSoft: string;
    accentBorder: string;
    focusRing: string;
    danger: string;
    dangerHover: string;
    dangerSoft: string;
    dangerBorder: string;
    warning: string;
    warningSoft: string;
    warningBorder: string;
    success: string;
    successSoft: string;
    successBorder: string;
    info: string;
    infoSoft: string;
    infoBorder: string;
  };
  radius: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
    control: string;
    panel: string;
  };
  shadow: {
    xs: string;
    sm: string;
    md: string;
    focus: string;
    focusError: string;
  };
};

export type DensityTokens = {
  name: Density;
  pagePadding: string;
  gap: string;
  sectionGap: string;
  controlHeight: string;
  controlPaddingX: string;
  controlGap: string;
  controlFontSize: string;
  fieldGap: string;
  gridRowHeight: string;
  toolbarHeight: string;
  mobileBottomBarHeight: string;
  iconSize: string;
  touchTarget: string;
};

export const defaultTheme: ThemeTokens = {
  name: "default",
  fontFamilySans:
    "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
  fontFamilyMono:
    "\"SFMono-Regular\", Consolas, \"Liberation Mono\", Menlo, monospace",
  colors: {
    appBg: "#eef3f8",
    pageBg: "#f6f8fb",
    bg: "#eef3f8",
    fg: "#1f2937",
    fgMuted: "#475569",
    fgSubtle: "#475569",
    fgInverse: "#ffffff",
    surface: "#fbfcfe",
    surfaceMuted: "#f1f5f9",
    surfaceRaised: "#ffffff",
    surfaceAccent: "#eef6ff",
    rowHoverBg: "#d9e8ff",
    border: "#dbe3ec",
    borderMuted: "#e8eef5",
    borderStrong: "#c6d1de",
    muted: "#475569",
    subtle: "#475569",
    // Erve brand primary — sourced from @erve/tokens' crimsonTokens ramp
    // (approved base: 500 #e21838, approved solid-fill: 600 #c21530; see
    // packages/tokens/src/index.ts for full derivation/contrast notes).
    // `accent` is the SOLID-FILL step (buttons, checked controls), not the
    // raw sampled hue — 500 only clears WCAG AA's 4.5:1 white-text
    // threshold by a negligible margin (~4.75:1), while 600 gives real
    // headroom (~6.09:1).
    accent: crimsonTokens[600],
    accentHover: crimsonTokens[700],
    accentActive: crimsonTokens[800],
    accentSoft: crimsonTokens[50],
    accentBorder: crimsonTokens[100],
    // Translucent version of the solid-fill step (600), mirroring the
    // pre-existing pattern where focusRing was a low-alpha rgb() of
    // whatever the primary color was.
    focusRing: "rgb(194 21 48 / 0.28)",
    // Danger/info have an exact 1:1 match in @erve/tokens' generic
    // red/blue scales, so they're sourced from there. Success/warning do
    // NOT have an exact-matching step in the current amber/green scales
    // (nearest neighbors are amber.700/#b45309 and green.700/#15803d,
    // both visibly different from the values already shipping in
    // production) — changing them to force a token match would alter
    // unrelated, already-shipped UI colors, which is out of scope here,
    // so they remain hand-authored literals. Information stays blue;
    // danger stays on the generic destructive-red family — neither is
    // replaced by the brand crimson.
    danger: colorTokens.red[700],
    dangerHover: colorTokens.red[700],
    dangerSoft: colorTokens.red[50],
    dangerBorder: colorTokens.red[100],
    warning: "#92400e",
    warningSoft: "#fffbeb",
    warningBorder: "#fde68a",
    success: "#166534",
    successSoft: "#f0fdf4",
    successBorder: "#bbf7d0",
    info: colorTokens.blue[600],
    infoSoft: colorTokens.blue[50],
    infoBorder: colorTokens.blue[100],
  },
  radius: {
    xs: "0.125rem",
    sm: "0.25rem",
    md: "0.375rem",
    lg: "0.5rem",
    xl: "0.75rem",
    control: "0.375rem",
    panel: "0.5rem",
  },
  shadow: {
    xs: "0 1px 2px rgb(15 23 42 / 0.06)",
    sm: "0 1px 3px rgb(15 23 42 / 0.12), 0 1px 2px rgb(15 23 42 / 0.08)",
    md: "0 10px 25px rgb(15 23 42 / 0.12)",
    focus: "0 0 0 3px rgb(194 21 48 / 0.28)",
    focusError: "0 0 0 3px rgb(185 28 28 / 0.20)",
  },
};

export const clientATheme: ThemeTokens = {
  ...defaultTheme,
  name: "clientA",
  colors: {
    ...defaultTheme.colors,
    appBg: "#edf3ff",
    pageBg: "#f5f8ff",
    bg: "#edf3ff",
    surfaceAccent: "#edf4ff",
    rowHoverBg: "#d5e2f9",
    accent: "#1455d9",
    accentHover: "#0f47bd",
    accentActive: "#0b3a99",
    accentSoft: "#edf4ff",
    accentBorder: "#c7dcff",
    focusRing: "rgb(20 85 217 / 0.30)",
    info: "#1455d9",
    infoSoft: "#edf4ff",
    infoBorder: "#c7dcff",
  },
};

export const clientBTheme: ThemeTokens = {
  ...defaultTheme,
  name: "clientB",
  colors: {
    ...defaultTheme.colors,
    appBg: "#edf7f5",
    pageBg: "#f4fbf9",
    bg: "#edf7f5",
    surfaceAccent: "#ecfdf5",
    rowHoverBg: "#cce5e3",
    accent: "#0f766e",
    accentHover: "#0d625c",
    accentActive: "#115e59",
    accentSoft: "#ecfdf5",
    accentBorder: "#a7f3d0",
    focusRing: "rgb(15 118 110 / 0.30)",
    info: "#0f766e",
    infoSoft: "#ecfdf5",
    infoBorder: "#a7f3d0",
  },
  radius: {
    ...defaultTheme.radius,
    control: "0.25rem",
    panel: "0.375rem",
  },
};

export const densityTokens: Record<Density, DensityTokens> = {
  compact: {
    name: "compact",
    pagePadding: "16px",
    gap: "8px",
    sectionGap: "12px",
    controlHeight: "32px",
    controlPaddingX: "12px",
    controlGap: "6px",
    controlFontSize: "0.75rem",
    fieldGap: "6px",
    gridRowHeight: "32px",
    toolbarHeight: "40px",
    mobileBottomBarHeight: "56px",
    iconSize: "16px",
    touchTarget: "32px",
  },
  comfortable: {
    name: "comfortable",
    pagePadding: "24px",
    gap: "12px",
    sectionGap: "16px",
    controlHeight: "36px",
    controlPaddingX: "14px",
    controlGap: "8px",
    controlFontSize: "0.875rem",
    fieldGap: "8px",
    gridRowHeight: "40px",
    toolbarHeight: "48px",
    mobileBottomBarHeight: "64px",
    iconSize: "18px",
    touchTarget: "36px",
  },
  touch: {
    name: "touch",
    pagePadding: "20px",
    gap: "16px",
    sectionGap: "20px",
    controlHeight: "44px",
    controlPaddingX: "18px",
    controlGap: "10px",
    controlFontSize: "1rem",
    fieldGap: "10px",
    gridRowHeight: "48px",
    toolbarHeight: "56px",
    mobileBottomBarHeight: "72px",
    iconSize: "20px",
    touchTarget: "44px",
  },
};

export const themes: Record<ThemeName, ThemeTokens> = {
  default: defaultTheme,
  clientA: clientATheme,
  clientB: clientBTheme,
};

export const getTheme = (theme: ThemeName | ThemeTokens = "default"): ThemeTokens =>
  typeof theme === "string" ? themes[theme] : theme;

export const getDensity = (density: Density = "comfortable"): DensityTokens =>
  densityTokens[density];

export const supportedThemeNames = Object.keys(themes) as ThemeName[];
export const supportedDensities = Object.keys(densityTokens) as Density[];
export const supportedColorModes = supportedThemeModes;
export const productionColorMode: ColorMode = "light";

export const requiredThemeVariables = [
  "--erp-color-background",
  "--erp-color-app-bg",
  "--erp-color-page-bg",
  "--erp-color-foreground",
  "--erp-color-foreground-muted",
  "--erp-color-foreground-subtle",
  "--erp-color-foreground-inverse",
  "--erp-color-surface",
  "--erp-color-surface-muted",
  "--erp-color-surface-raised",
  "--erp-color-surface-accent",
  "--erp-color-border",
  "--erp-color-border-muted",
  "--erp-color-border-strong",
  "--erp-color-primary",
  "--erp-color-primary-foreground",
  "--erp-color-primary-hover",
  "--erp-color-primary-active",
  "--erp-color-primary-soft",
  "--erp-color-primary-border",
  "--erp-color-secondary",
  "--erp-color-secondary-foreground",
  "--erp-color-muted",
  "--erp-color-muted-foreground",
  "--erp-color-danger",
  "--erp-color-danger-foreground",
  "--erp-color-warning",
  "--erp-color-warning-foreground",
  "--erp-color-success",
  "--erp-color-success-foreground",
  "--erp-color-info",
  "--erp-color-info-foreground",
  "--erp-surface-page",
  "--erp-surface-panel",
  "--erp-surface-card",
  "--erp-surface-raised",
  "--erp-surface-sunken",
  "--erp-surface-overlay",
  "--erp-surface-hover",
  "--erp-surface-selected",
  "--erp-surface-active",
  "--erp-surface-disabled",
  "--erp-surface-inverse",
  "--erp-text-primary",
  "--erp-text-secondary",
  "--erp-text-muted",
  "--erp-text-subtle",
  "--erp-text-disabled",
  "--erp-text-inverse",
  "--erp-text-link",
  "--erp-text-accent",
  "--erp-text-danger",
  "--erp-text-warning",
  "--erp-text-success",
  "--erp-text-info",
  "--erp-border-default",
  "--erp-border-muted",
  "--erp-border-strong",
  "--erp-border-focus",
  "--erp-border-danger",
  "--erp-border-warning",
  "--erp-border-success",
  "--erp-border-selected",
  "--erp-border-disabled",
  "--erp-state-hover",
  "--erp-state-active",
  "--erp-state-selected",
  "--erp-state-focus",
  "--erp-state-disabled",
  "--erp-state-readonly",
  "--erp-state-loading",
  "--erp-state-dragging",
  "--erp-state-blocked",
  "--erp-state-locked",
  "--erp-state-new",
  "--erp-state-dirty",
  "--erp-state-deleted",
  "--erp-state-stale",
  "--erp-state-error",
  "--erp-state-warning",
  "--erp-state-saving",
  "--erp-state-dirty-border",
  "--erp-state-deleted-border",
  "--erp-state-error-border",
  "--erp-state-warning-border",
  "--erp-state-stale-border",
  "--erp-validation-info-bg",
  "--erp-validation-info-text",
  "--erp-validation-info-border",
  "--erp-validation-info-icon",
  "--erp-validation-warning-bg",
  "--erp-validation-warning-text",
  "--erp-validation-warning-border",
  "--erp-validation-warning-icon",
  "--erp-validation-error-bg",
  "--erp-validation-error-text",
  "--erp-validation-error-border",
  "--erp-validation-error-icon",
  "--erp-validation-blocking-bg",
  "--erp-validation-blocking-text",
  "--erp-validation-blocking-border",
  "--erp-validation-blocking-icon",
  "--erp-grid-header-bg",
  "--erp-grid-header-text",
  "--erp-grid-header-border",
  "--erp-grid-row-bg",
  "--erp-grid-row-alt-bg",
  "--erp-grid-row-hover-bg",
  "--erp-grid-row-selected-bg",
  "--erp-grid-row-new-bg",
  "--erp-grid-row-dirty-bg",
  "--erp-grid-row-deleted-bg",
  "--erp-grid-row-error-bg",
  "--erp-grid-row-warning-bg",
  "--erp-grid-row-stale-bg",
  "--erp-grid-row-readonly-bg",
  "--erp-grid-row-border",
  "--erp-grid-cell-bg",
  "--erp-grid-cell-editing-bg",
  "--erp-grid-cell-focus-ring",
  "--erp-grid-cell-readonly-bg",
  "--erp-grid-cell-error-bg",
  "--erp-grid-cell-warning-bg",
  "--erp-grid-cell-stale-bg",
  "--erp-grid-cell-pinned-bg",
  "--erp-grid-footer-bg",
  "--erp-grid-footer-text",
  "--erp-grid-total-row-bg",
  "--erp-grid-group-row-bg",
  "--erp-grid-resize-handle",
  "--erp-grid-selection-handle",
  "--erp-shell-topbar-height",
  "--erp-shell-sidebar-width",
  "--erp-shell-sidebar-collapsed-width",
  "--erp-shell-footer-height",
  "--erp-shell-mobile-header-height",
  "--erp-shell-mobile-bottom-nav-height",
  "--erp-shell-mobile-bottom-bar-height",
  "--erp-shell-workspace-tabs-height",
  "--erp-shell-content-max-width",
  "--erp-shell-content-padding",
  "--erp-shell-content-gap",
  "--erp-shell-panel-padding",
  "--erp-shell-panel-gap",
  "--erp-shell-split-pane-min-width",
  "--erp-shell-split-pane-divider-width",
  "--erp-form-label-width",
  "--erp-form-label-gap",
  "--erp-form-label-color",
  "--erp-form-label-required-color",
  "--erp-form-field-gap",
  "--erp-form-field-inline-gap",
  "--erp-form-field-help-text-color",
  "--erp-form-field-error-text-color",
  "--erp-form-field-disabled-bg",
  "--erp-form-field-readonly-bg",
  "--erp-form-field-border",
  "--erp-form-field-error-border",
  "--erp-form-field-focus-border",
  "--erp-form-section-gap",
  "--erp-form-section-padding",
  "--erp-form-section-border",
  "--erp-form-error-gap",
  "--erp-form-required-marker-color",
  "--erp-size-intent-hug",
  "--erp-size-intent-fill",
  "--erp-size-intent-fit",
  "--erp-control-width-xs",
  "--erp-control-width-sm",
  "--erp-control-width-md",
  "--erp-control-width-lg",
  "--erp-control-width-xl",
  "--erp-status-draft",
  "--erp-status-draft-bg",
  "--erp-status-draft-fg",
  "--erp-status-draft-border",
  "--erp-status-submitted",
  "--erp-status-submitted-bg",
  "--erp-status-submitted-fg",
  "--erp-status-submitted-border",
  "--erp-status-approved",
  "--erp-status-approved-bg",
  "--erp-status-approved-fg",
  "--erp-status-approved-border",
  "--erp-status-rejected",
  "--erp-status-rejected-bg",
  "--erp-status-rejected-fg",
  "--erp-status-rejected-border",
  "--erp-status-posted",
  "--erp-status-posted-bg",
  "--erp-status-posted-fg",
  "--erp-status-posted-border",
  "--erp-status-cancelled",
  "--erp-status-cancelled-bg",
  "--erp-status-cancelled-fg",
  "--erp-status-cancelled-border",
  "--erp-status-pending-bg",
  "--erp-status-pending-fg",
  "--erp-status-pending-border",
  "--erp-status-warning-bg",
  "--erp-status-warning-fg",
  "--erp-status-warning-border",
  "--erp-status-success-bg",
  "--erp-status-success-fg",
  "--erp-status-success-border",
  "--erp-status-danger-bg",
  "--erp-status-danger-fg",
  "--erp-status-danger-border",
  "--erp-status-info-bg",
  "--erp-status-info-fg",
  "--erp-status-info-border",
  "--erp-focus-ring",
  "--erp-focus-ring-width",
  "--erp-focus-ring-offset",
  "--erp-disabled-opacity",
  "--erp-radius-sm",
  "--erp-radius-md",
  "--erp-radius-lg",
  "--erp-radius-xl",
  "--erp-radius-card",
  "--erp-radius-shell",
  "--erp-shadow-none",
  "--erp-shadow-sm",
  "--erp-shadow-md",
  "--erp-shadow-card",
  "--erp-shadow-floating",
  "--erp-control-height",
  "--erp-control-padding-x",
  "--erp-control-gap",
  "--erp-field-gap",
  "--erp-page-padding",
  "--erp-section-gap",
  "--erp-grid-row-height",
  "--erp-toolbar-height",
  "--erp-mobile-bottom-bar-height",
  "--erp-icon-size",
  "--erp-font-sans",
  "--erp-font-mono",
  "--erp-font-size-xs",
  "--erp-font-size-sm",
  "--erp-font-size-md",
  "--erp-font-size-lg",
  "--erp-kpi-card-min-height",
  "--erp-kpi-icon-size",
  "--erp-kpi-icon-radius",
  "--erp-kpi-trend-positive-fg",
  "--erp-kpi-trend-negative-fg",
  "--erp-chart-grid-color",
  "--erp-chart-axis-color",
] as const;

export type ThemeVariableName = (typeof requiredThemeVariables)[number] | `--erp-${string}`;
export type ThemeVariableMap = Record<ThemeVariableName, string>;

export type ThemeOptions = {
  theme?: ThemeName | ThemeTokens;
  density?: Density;
  colorMode?: ColorMode;
};

export const getThemeVariables = (
  theme: ThemeName | ThemeTokens = "default",
  density: Density = "comfortable",
  colorMode: ColorMode = productionColorMode,
): ThemeVariableMap => {
  const t = getTheme(theme);
  const d = getDensity(density);

  return {
    "--erp-font-sans": t.fontFamilySans,
    "--erp-font-mono": t.fontFamilyMono,
    "--erp-font-family-sans": t.fontFamilySans,
    "--erp-font-family-mono": t.fontFamilyMono,
    "--erp-font-size-xs": "0.75rem",
    "--erp-font-size-sm": "0.875rem",
    "--erp-font-size-md": "1rem",
    "--erp-font-size-lg": "1.125rem",
    "--erp-color-background": t.colors.pageBg,
    "--erp-color-app-bg": t.colors.appBg,
    "--erp-color-page-bg": t.colors.pageBg,
    "--erp-color-foreground": t.colors.fg,
    "--erp-color-foreground-muted": t.colors.fgMuted,
    "--erp-color-foreground-subtle": t.colors.fgSubtle,
    "--erp-color-foreground-inverse": t.colors.fgInverse,
    "--erp-color-surface": t.colors.surface,
    "--erp-color-surface-muted": t.colors.surfaceMuted,
    "--erp-color-surface-raised": t.colors.surfaceRaised,
    "--erp-color-surface-accent": t.colors.surfaceAccent,
    "--erp-color-border": t.colors.border,
    "--erp-color-border-muted": t.colors.borderMuted,
    "--erp-color-border-strong": t.colors.borderStrong,
    "--erp-color-primary": t.colors.accent,
    "--erp-color-primary-foreground": "#ffffff",
    "--erp-color-primary-hover": t.colors.accentHover,
    "--erp-color-primary-active": t.colors.accentActive,
    "--erp-color-primary-soft": t.colors.accentSoft,
    "--erp-color-primary-border": t.colors.accentBorder,
    "--erp-color-secondary": t.colors.surface,
    "--erp-color-secondary-foreground": t.colors.fg,
    "--erp-color-muted": t.colors.surfaceMuted,
    "--erp-color-muted-foreground": t.colors.muted,
    "--erp-color-danger": t.colors.danger,
    "--erp-color-danger-foreground": "#ffffff",
    "--erp-color-warning": t.colors.warning,
    "--erp-color-warning-foreground": "#ffffff",
    "--erp-color-success": t.colors.success,
    "--erp-color-success-foreground": "#ffffff",
    "--erp-color-info": t.colors.info,
    "--erp-color-info-foreground": "#ffffff",
    "--erp-surface-page": t.colors.pageBg,
    "--erp-surface-panel": t.colors.surface,
    "--erp-surface-card": t.colors.surface,
    "--erp-surface-raised": t.colors.surfaceRaised,
    "--erp-surface-sunken": t.colors.surfaceMuted,
    "--erp-surface-overlay": "rgb(15 23 42 / 0.55)",
    "--erp-surface-hover": t.colors.surfaceMuted,
    "--erp-surface-selected": t.colors.accentSoft,
    "--erp-surface-active": t.colors.accentBorder,
    "--erp-surface-disabled": t.colors.surfaceMuted,
    "--erp-surface-inverse": t.colors.fg,
    "--erp-text-primary": t.colors.fg,
    "--erp-text-secondary": "#334155",
    "--erp-text-muted": t.colors.fgMuted,
    "--erp-text-subtle": t.colors.fgSubtle,
    "--erp-text-disabled": t.colors.fgSubtle,
    "--erp-text-inverse": t.colors.fgInverse,
    "--erp-text-link": t.colors.accentHover,
    // Dedicated accent-foreground-text role (see theme.css's --erp-text-accent
    // doc comment) — same source value as --erp-text-link, kept as a
    // separate name so components read a role that isn't the solid-fill
    // --erp-color-primary token.
    "--erp-text-accent": t.colors.accentHover,
    "--erp-text-danger": t.colors.danger,
    "--erp-text-warning": t.colors.warning,
    "--erp-text-success": t.colors.success,
    "--erp-text-info": t.colors.info,
    "--erp-border-default": t.colors.border,
    "--erp-border-muted": t.colors.borderMuted,
    "--erp-border-strong": t.colors.borderStrong,
    "--erp-border-focus": t.colors.accent,
    "--erp-border-danger": t.colors.dangerBorder,
    "--erp-border-warning": t.colors.warningBorder,
    "--erp-border-success": t.colors.successBorder,
    "--erp-border-selected": t.colors.accentBorder,
    "--erp-border-disabled": t.colors.border,
    "--erp-state-hover": t.colors.surfaceMuted,
    "--erp-state-active": t.colors.accentBorder,
    "--erp-state-selected": t.colors.accentSoft,
    "--erp-state-focus": t.colors.focusRing,
    "--erp-state-disabled": t.colors.surfaceMuted,
    "--erp-state-readonly": t.colors.surfaceMuted,
    "--erp-state-loading": t.colors.infoSoft,
    "--erp-state-dragging": t.colors.accentSoft,
    "--erp-state-blocked": t.colors.dangerSoft,
    "--erp-state-locked": t.colors.surfaceMuted,
    "--erp-state-new": t.colors.successSoft,
    "--erp-state-dirty": t.colors.warningSoft,
    "--erp-state-deleted": t.colors.dangerSoft,
    "--erp-state-stale": t.colors.infoSoft,
    "--erp-state-error": t.colors.dangerSoft,
    "--erp-state-warning": t.colors.warningSoft,
    "--erp-state-saving": t.colors.infoSoft,
    "--erp-state-dirty-border": t.colors.warningBorder,
    "--erp-state-deleted-border": t.colors.dangerBorder,
    "--erp-state-error-border": t.colors.dangerBorder,
    "--erp-state-warning-border": t.colors.warningBorder,
    "--erp-state-stale-border": t.colors.infoBorder,
    "--erp-validation-info-bg": t.colors.infoSoft,
    "--erp-validation-info-text": t.colors.info,
    "--erp-validation-info-border": t.colors.infoBorder,
    "--erp-validation-info-icon": t.colors.info,
    "--erp-validation-warning-bg": t.colors.warningSoft,
    "--erp-validation-warning-text": t.colors.warning,
    "--erp-validation-warning-border": t.colors.warningBorder,
    "--erp-validation-warning-icon": t.colors.warning,
    "--erp-validation-error-bg": t.colors.dangerSoft,
    "--erp-validation-error-text": t.colors.danger,
    "--erp-validation-error-border": t.colors.dangerBorder,
    "--erp-validation-error-icon": t.colors.danger,
    "--erp-validation-blocking-bg": t.colors.dangerSoft,
    "--erp-validation-blocking-text": t.colors.danger,
    "--erp-validation-blocking-border": t.colors.dangerBorder,
    "--erp-validation-blocking-icon": t.colors.danger,
    "--erp-grid-header-bg": t.colors.surfaceMuted,
    "--erp-grid-header-text": t.colors.muted,
    "--erp-grid-header-border": t.colors.border,
    "--erp-grid-row-bg": t.colors.surface,
    "--erp-grid-row-alt-bg": t.colors.surfaceMuted,
    "--erp-grid-row-hover-bg": t.colors.rowHoverBg,
    "--erp-grid-row-selected-bg": t.colors.accentSoft,
    "--erp-grid-row-new-bg": t.colors.successSoft,
    "--erp-grid-row-dirty-bg": t.colors.warningSoft,
    "--erp-grid-row-deleted-bg": t.colors.dangerSoft,
    "--erp-grid-row-error-bg": t.colors.dangerSoft,
    "--erp-grid-row-warning-bg": t.colors.warningSoft,
    "--erp-grid-row-stale-bg": t.colors.infoSoft,
    "--erp-grid-row-readonly-bg": t.colors.surfaceMuted,
    "--erp-grid-row-border": t.colors.border,
    "--erp-grid-cell-bg": t.colors.surface,
    "--erp-grid-cell-editing-bg": t.colors.accentSoft,
    "--erp-grid-cell-focus-ring": t.colors.focusRing,
    "--erp-grid-cell-readonly-bg": "transparent",
    "--erp-grid-cell-error-bg": t.colors.dangerSoft,
    "--erp-grid-cell-warning-bg": t.colors.warningSoft,
    "--erp-grid-cell-stale-bg": t.colors.infoSoft,
    "--erp-grid-cell-pinned-bg": t.colors.surfaceMuted,
    "--erp-grid-footer-bg": t.colors.surfaceMuted,
    "--erp-grid-footer-text": t.colors.fg,
    "--erp-grid-total-row-bg": t.colors.surfaceMuted,
    "--erp-grid-group-row-bg": t.colors.surfaceMuted,
    "--erp-grid-resize-handle": t.colors.borderStrong,
    "--erp-grid-selection-handle": t.colors.accent,
    "--erp-shell-topbar-height": d.toolbarHeight,
    "--erp-shell-sidebar-width": "16rem",
    "--erp-shell-sidebar-collapsed-width": "4rem",
    "--erp-shell-footer-height": d.toolbarHeight,
    "--erp-shell-mobile-header-height": d.toolbarHeight,
    "--erp-shell-mobile-bottom-nav-height": d.mobileBottomBarHeight,
    "--erp-shell-mobile-bottom-bar-height": d.mobileBottomBarHeight,
    "--erp-shell-workspace-tabs-height": d.toolbarHeight,
    "--erp-shell-content-max-width": "80rem",
    "--erp-shell-content-padding": d.pagePadding,
    "--erp-shell-content-gap": d.gap,
    "--erp-shell-panel-padding": d.pagePadding,
    "--erp-shell-panel-gap": d.sectionGap,
    "--erp-shell-split-pane-min-width": "18rem",
    "--erp-shell-split-pane-divider-width": "1px",
    "--erp-form-label-width": "10rem",
    "--erp-form-label-gap": d.controlGap,
    "--erp-form-label-color": t.colors.fg,
    "--erp-form-label-required-color": t.colors.danger,
    "--erp-form-field-gap": d.fieldGap,
    "--erp-form-field-inline-gap": d.gap,
    "--erp-form-field-help-text-color": t.colors.muted,
    "--erp-form-field-error-text-color": t.colors.danger,
    "--erp-form-field-disabled-bg": t.colors.surfaceMuted,
    "--erp-form-field-readonly-bg": t.colors.surfaceMuted,
    "--erp-form-field-border": t.colors.borderStrong,
    "--erp-form-field-error-border": t.colors.dangerBorder,
    "--erp-form-field-focus-border": t.colors.accent,
    "--erp-form-section-gap": d.sectionGap,
    "--erp-form-section-padding": d.pagePadding,
    "--erp-form-section-border": t.colors.border,
    "--erp-form-error-gap": "0.25rem",
    "--erp-form-required-marker-color": t.colors.danger,
    "--erp-size-intent-hug": "max-content",
    "--erp-size-intent-fill": "100%",
    "--erp-size-intent-fit": "fit-content",
    "--erp-control-width-xs": "6rem",
    "--erp-control-width-sm": "8rem",
    "--erp-control-width-md": "12rem",
    "--erp-control-width-lg": "16rem",
    "--erp-control-width-xl": "24rem",
    "--erp-status-draft": "#475569",
    "--erp-status-draft-foreground": "#ffffff",
    "--erp-status-draft-soft": t.colors.surfaceMuted,
    "--erp-status-draft-bg": t.colors.surfaceMuted,
    "--erp-status-draft-fg": "#475569",
    "--erp-status-draft-border": t.colors.borderStrong,
    "--erp-status-submitted": t.colors.info,
    "--erp-status-submitted-foreground": "#ffffff",
    "--erp-status-submitted-soft": t.colors.infoSoft,
    "--erp-status-submitted-bg": t.colors.infoSoft,
    "--erp-status-submitted-fg": t.colors.info,
    "--erp-status-submitted-border": t.colors.infoBorder,
    "--erp-status-approved": t.colors.success,
    "--erp-status-approved-foreground": "#ffffff",
    "--erp-status-approved-soft": t.colors.successSoft,
    "--erp-status-approved-bg": t.colors.successSoft,
    "--erp-status-approved-fg": t.colors.success,
    "--erp-status-approved-border": t.colors.successBorder,
    "--erp-status-rejected": t.colors.danger,
    "--erp-status-rejected-foreground": "#ffffff",
    "--erp-status-rejected-soft": t.colors.dangerSoft,
    "--erp-status-rejected-bg": t.colors.dangerSoft,
    "--erp-status-rejected-fg": t.colors.danger,
    "--erp-status-rejected-border": t.colors.dangerBorder,
    "--erp-status-posted": "#4338ca",
    "--erp-status-posted-foreground": "#ffffff",
    "--erp-status-posted-soft": "#eef2ff",
    "--erp-status-posted-bg": "#eef2ff",
    "--erp-status-posted-fg": "#4338ca",
    "--erp-status-posted-border": "#c7d2fe",
    "--erp-status-cancelled": "#475569",
    "--erp-status-cancelled-foreground": "#ffffff",
    "--erp-status-cancelled-soft": "#f1f5f9",
    "--erp-status-cancelled-bg": "#f1f5f9",
    "--erp-status-cancelled-fg": "#475569",
    "--erp-status-cancelled-border": "#cbd5e1",
    "--erp-status-pending-bg": t.colors.warningSoft,
    "--erp-status-pending-fg": t.colors.warning,
    "--erp-status-pending-border": t.colors.warningBorder,
    "--erp-status-warning-bg": t.colors.warningSoft,
    "--erp-status-warning-fg": t.colors.warning,
    "--erp-status-warning-border": t.colors.warningBorder,
    "--erp-status-success-bg": t.colors.successSoft,
    "--erp-status-success-fg": t.colors.success,
    "--erp-status-success-border": t.colors.successBorder,
    "--erp-status-danger-bg": t.colors.dangerSoft,
    "--erp-status-danger-fg": t.colors.danger,
    "--erp-status-danger-border": t.colors.dangerBorder,
    "--erp-status-info-bg": t.colors.infoSoft,
    "--erp-status-info-fg": t.colors.info,
    "--erp-status-info-border": t.colors.infoBorder,
    "--erp-bg": t.colors.appBg,
    "--erp-fg": t.colors.fg,
    "--erp-surface": t.colors.surface,
    "--erp-surface-muted": t.colors.surfaceMuted,
    "--erp-border": t.colors.border,
    "--erp-muted": t.colors.muted,
    "--erp-subtle": t.colors.subtle,
    "--erp-accent": t.colors.accent,
    "--erp-accent-hover": t.colors.accentHover,
    "--erp-accent-active": t.colors.accentActive,
    "--erp-accent-soft": t.colors.accentSoft,
    "--erp-accent-border": t.colors.accentBorder,
    "--erp-focus-ring": t.colors.focusRing,
    "--erp-danger": t.colors.danger,
    "--erp-danger-hover": t.colors.dangerHover,
    "--erp-danger-soft": t.colors.dangerSoft,
    "--erp-danger-border": t.colors.dangerBorder,
    "--erp-warning": t.colors.warning,
    "--erp-warning-soft": t.colors.warningSoft,
    "--erp-warning-border": t.colors.warningBorder,
    "--erp-success": t.colors.success,
    "--erp-success-soft": t.colors.successSoft,
    "--erp-success-border": t.colors.successBorder,
    "--erp-info": t.colors.info,
    "--erp-info-soft": t.colors.infoSoft,
    "--erp-info-border": t.colors.infoBorder,
    "--erp-radius-xs": t.radius.xs,
    "--erp-radius-sm": t.radius.sm,
    "--erp-radius-md": t.radius.md,
    "--erp-radius-lg": t.radius.lg,
    "--erp-radius-xl": t.radius.xl,
    "--erp-radius-control": t.radius.control,
    "--erp-radius-panel": t.radius.panel,
    "--erp-radius-card": t.radius.panel,
    "--erp-radius-shell": t.radius.xl,
    "--erp-shadow-none": "none",
    "--erp-shadow-xs": t.shadow.xs,
    "--erp-shadow-sm": t.shadow.sm,
    "--erp-shadow-md": t.shadow.md,
    "--erp-shadow-card": t.shadow.sm,
    "--erp-shadow-floating": t.shadow.md,
    "--erp-shadow-focus": t.shadow.focus,
    "--erp-shadow-focus-error": t.shadow.focusError,
    "--erp-focus-ring-width": "2px",
    "--erp-focus-ring-offset": "1px",
    "--erp-disabled-opacity": "0.5",
    "--erp-page-padding": d.pagePadding,
    "--erp-gap": d.gap,
    "--erp-control-height": d.controlHeight,
    "--erp-control-padding-x": d.controlPaddingX,
    "--erp-control-gap": d.controlGap,
    "--erp-control-font-size": d.controlFontSize,
    "--erp-field-gap": d.fieldGap,
    "--erp-section-gap": d.sectionGap,
    "--erp-grid-row-height": d.gridRowHeight,
    "--erp-toolbar-height": d.toolbarHeight,
    "--erp-mobile-bottom-bar-height": d.mobileBottomBarHeight,
    "--erp-icon-size": d.iconSize,
    "--erp-touch-target": d.touchTarget,
    "--erp-kpi-card-min-height": "7rem",
    "--erp-kpi-icon-size": "2.5rem",
    "--erp-kpi-icon-radius": t.radius.lg,
    "--erp-kpi-trend-positive-fg": t.colors.success,
    "--erp-kpi-trend-negative-fg": t.colors.danger,
    "--erp-chart-grid-color": t.colors.borderMuted,
    "--erp-chart-axis-color": t.colors.fgMuted,
    "--erp-color-mode": colorMode,
  };
};

export const createThemeStyle = (
  theme: ThemeName | ThemeTokens = "default",
  density: Density = "comfortable",
  colorMode: ColorMode = productionColorMode,
): CSSProperties => getThemeVariables(theme, density, colorMode) as CSSProperties;

export function applyTheme(
  element: HTMLElement,
  options?: ThemeOptions,
): () => void;
export function applyTheme(
  theme?: ThemeName | ThemeTokens,
  density?: Density,
  colorMode?: ColorMode,
): CSSProperties;
export function applyTheme(
  elementOrTheme: HTMLElement | ThemeName | ThemeTokens = "default",
  optionsOrDensity: ThemeOptions | Density = "comfortable",
  colorMode: ColorMode = productionColorMode,
): CSSProperties | (() => void) {
  if (typeof HTMLElement !== "undefined" && elementOrTheme instanceof HTMLElement) {
    const element = elementOrTheme;
    const options =
      typeof optionsOrDensity === "object" ? optionsOrDensity : { density: optionsOrDensity };
    const themeTokens = getTheme(options.theme);
    const densityName = options.density ?? "comfortable";
    const resolvedColorMode = options.colorMode ?? productionColorMode;
    const variables = getThemeVariables(themeTokens, densityName, resolvedColorMode);
    const previousTheme = element.getAttribute("data-theme");
    const previousDensity = element.getAttribute("data-density");
    const previousColorMode = element.getAttribute("data-color-mode");
    const previousValues = Object.keys(variables).map((name) => [
      name,
      element.style.getPropertyValue(name),
    ] as const);

    element.setAttribute("data-theme", themeTokens.name);
    element.setAttribute("data-density", densityName);
    element.setAttribute("data-color-mode", resolvedColorMode);

    for (const [name, value] of Object.entries(variables)) {
      element.style.setProperty(name, value);
    }

    return () => {
      restoreAttribute(element, "data-theme", previousTheme);
      restoreAttribute(element, "data-density", previousDensity);
      restoreAttribute(element, "data-color-mode", previousColorMode);

      for (const [name, value] of previousValues) {
        if (value) {
          element.style.setProperty(name, value);
        } else {
          element.style.removeProperty(name);
        }
      }
    };
  }

  return createThemeStyle(
    elementOrTheme as ThemeName | ThemeTokens,
    optionsOrDensity as Density,
    colorMode,
  );
}

const restoreAttribute = (
  element: HTMLElement,
  name: string,
  previousValue: string | null,
) => {
  if (previousValue) {
    element.setAttribute(name, previousValue);
  } else {
    element.removeAttribute(name);
  }
};

export type ThemeContextValue = {
  theme: ThemeTokens;
  density: DensityTokens;
  themeName: ThemeName;
  densityName: Density;
  /** The user's selected mode — may be "system"; not the resolved appearance. */
  colorMode: ColorMode;
  /** The actual light/dark appearance after resolving "system" against the device/OS. */
  resolvedTheme: ResolvedTheme;
  setColorMode: (mode: ThemeMode) => void;
};

const noopSetColorMode = (_mode: ThemeMode): void => {};

const ThemeContext = createContext<ThemeContextValue>({
  theme: defaultTheme,
  density: densityTokens.comfortable,
  themeName: "default",
  densityName: "comfortable",
  colorMode: productionColorMode,
  resolvedTheme: "light",
  setColorMode: noopSetColorMode,
});

export interface ThemeProviderProps {
  theme?: ThemeName | ThemeTokens;
  density?: Density;
  /** Controlled selected mode. When supplied, ThemeProvider never changes it internally. */
  colorMode?: ThemeMode;
  /** Initial selected mode for uncontrolled usage; ignored when `colorMode` is supplied. */
  defaultColorMode?: ThemeMode;
  /** Notified on every `setColorMode()` call, in both controlled and uncontrolled usage. */
  onColorModeChange?: (mode: ThemeMode) => void;
  children: ReactNode;
}

/**
 * ThemeProvider is a GLOBAL singleton by design: it writes `.dark`,
 * `data-theme`, `data-density`, `data-color-mode` (and, for custom
 * ThemeTokens objects, CSS variables) directly onto `document.documentElement`
 * so that Radix portal content (Dialog/DropdownMenu/Tooltip — mounted as
 * siblings of `document.body`, outside any inner React wrapper) inherits the
 * same theme. Two ThemeProviders mounted at once would fight over that same
 * global DOM state, so mounting more than one only warns (never throws) —
 * mount exactly one at the application root.
 */
let activeProviderCount = 0;

export const ThemeProvider = ({
  theme = "default",
  density = "comfortable",
  colorMode,
  defaultColorMode,
  onColorModeChange,
  children,
}: ThemeProviderProps) => {
  const isControlled = colorMode !== undefined;
  const [uncontrolledMode, setUncontrolledMode] = useState<ThemeMode>(
    () => defaultColorMode ?? getStoredThemePreference(),
  );
  const selectedMode = isControlled ? colorMode : uncontrolledMode;

  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() =>
    getSystemPrefersDark(),
  );
  useEffect(() => subscribeToSystemPreference(setSystemPrefersDark), []);

  const resolvedTheme = resolveTheme(selectedMode, systemPrefersDark);

  const setColorMode = useCallback(
    (mode: ThemeMode) => {
      if (!isControlled) {
        setUncontrolledMode(mode);
        setStoredThemePreference(mode);
      }
      onColorModeChange?.(mode);
    },
    [isControlled, onColorModeChange],
  );

  const isCustomTheme = typeof theme === "object" && theme !== null;
  const themeTokens = getTheme(theme);
  const themeName = themeTokens.name;
  const densityToken = getDensity(density);

  // Warn (never throw) on multiple simultaneously-mounted providers — see
  // the doc comment on `activeProviderCount` above.
  useEffect(() => {
    activeProviderCount += 1;
    if (activeProviderCount > 1) {
      console.warn(
        "[@erve/theme] More than one ThemeProvider is mounted at once. " +
          "ThemeProvider is a global singleton (it writes to document.documentElement) " +
          "— mount exactly one at the application root.",
      );
    }
    return () => {
      activeProviderCount -= 1;
    };
  }, []);

  // Snapshot pre-mount <html> state ONCE and restore it on true unmount only
  // (not on every re-render), so unrelated classes/attributes on <html>
  // survive this provider's lifecycle untouched. Declared BEFORE the
  // marker-application effect below so its snapshot runs first on mount —
  // React runs same-commit effects in declaration order, and if this ran
  // second it would snapshot the marker-application effect's OWN changes
  // instead of the true pre-mount state.
  useEffect(() => {
    const root = document.documentElement;
    const previousDataTheme = root.getAttribute("data-theme");
    const previousDataDensity = root.getAttribute("data-density");
    const previousDataColorMode = root.getAttribute("data-color-mode");
    const hadDarkClass = root.classList.contains("dark");
    const previousColorScheme = root.style.colorScheme;

    return () => {
      restoreAttribute(root, "data-theme", previousDataTheme);
      restoreAttribute(root, "data-density", previousDataDensity);
      restoreAttribute(root, "data-color-mode", previousDataColorMode);
      root.classList.toggle("dark", hadDarkClass);
      root.style.colorScheme = previousColorScheme;
    };
  }, []);

  // Global markers on <html> so Radix portals (mounted under document.body,
  // outside any inner wrapper) inherit theme/density/mode identically to the
  // rest of the app. `color-scheme` is set here too (not left to a
  // web-specific effect) since it's a direct, platform-neutral function of
  // `resolvedTheme` — native form controls, scrollbars, and other
  // browser-drawn UI need it on both web and a future mobile WebView.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", themeName);
    root.setAttribute("data-density", density);
    root.setAttribute("data-color-mode", selectedMode);
    root.classList.toggle("dark", resolvedTheme === "dark");
    root.style.colorScheme = resolvedTheme;
  }, [themeName, density, selectedMode, resolvedTheme]);

  // Custom ThemeTokens objects have no theme.css block to fall back on, so
  // their variables are applied directly to <html> (globally, so portal
  // content receives them too) and fully reverted — not merely overwritten —
  // whenever the custom theme changes or the provider unmounts, so switching
  // back to a predefined theme never leaves stale custom variables behind.
  useEffect(() => {
    if (!isCustomTheme) return undefined;

    const root = document.documentElement;
    const variables = getThemeVariables(themeTokens, density, resolvedTheme);
    const previousValues = Object.keys(variables).map(
      (name) => [name, root.style.getPropertyValue(name)] as const,
    );

    for (const [name, value] of Object.entries(variables)) {
      root.style.setProperty(name, value);
    }

    return () => {
      for (const [name, value] of previousValues) {
        if (value) {
          root.style.setProperty(name, value);
        } else {
          root.style.removeProperty(name);
        }
      }
    };
  }, [isCustomTheme, themeTokens, density, resolvedTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: themeTokens,
      density: densityToken,
      themeName,
      densityName: density,
      colorMode: selectedMode,
      resolvedTheme,
      setColorMode,
    }),
    [themeTokens, densityToken, themeName, density, selectedMode, resolvedTheme, setColorMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

ThemeProvider.displayName = "ThemeProvider";

export const useTheme = () => useContext(ThemeContext);
