export const colorTokens = {
  transparent: "transparent",
  current: "currentColor",
  white: "#ffffff",
  black: "#000000",
  neutral: {
    0: "#ffffff",
    50: "#f8fafc",
    100: "#f1f5f9",
    200: "#e2e8f0",
    300: "#cbd5e1",
    400: "#94a3b8",
    500: "#64748b",
    600: "#475569",
    700: "#334155",
    800: "#1e293b",
    900: "#0f172a",
    950: "#020617",
  },
  blue: {
    50: "#eff6ff",
    100: "#dbeafe",
    500: "#3b82f6",
    600: "#2563eb",
    700: "#1d4ed8",
  },
  green: {
    50: "#f0fdf4",
    100: "#dcfce7",
    500: "#22c55e",
    600: "#16a34a",
    700: "#15803d",
  },
  amber: {
    50: "#fffbeb",
    100: "#fef3c7",
    500: "#f59e0b",
    600: "#d97706",
    700: "#b45309",
  },
  red: {
    50: "#fef2f2",
    100: "#fee2e2",
    500: "#ef4444",
    600: "#dc2626",
    700: "#b91c1c",
  },
} as const;

/**
 * PROVISIONAL — candidate Erve brand ramp. NOT wired into `defaultTheme`,
 * `theme.css`, `apps/web`, or `apps/mobile`. Do not consume this export
 * until an authoritative brand color has been confirmed (see the doc
 * comment on `crimsonTokens` below for how the base value was derived and
 * why it is not yet a confirmed brand specification).
 *
 * This ramp is intentionally separate from `colorTokens.red` above:
 * `colorTokens.red` is the generic "danger" semantic hue and must keep
 * meaning "destructive/error" independently of whatever the confirmed
 * Erve brand color turns out to be — collapsing the two into one scale
 * would make it impossible to visually distinguish "primary brand action"
 * from "destructive action" once both are shades of red.
 */
export const crimsonTokens = {
  /**
   * Base value derivation (informational, not authoritative):
   * - `apps/web/public/erve-logo.png` (1117x153 raster wordmark): pixel
   *   decode found a single dominant fill color, rgb(226, 24, 56) / #e21838,
   *   across ~51,000 sampled non-transparent pixels — the logo is
   *   effectively monochrome, so this is a clean, high-confidence sample
   *   of *a* red the logo uses, not proof of an official brand hex.
   * - `apps/web/public/erve-favicon.png` (107x107 raster icon): a
   *   pixel-weighted average of the top 10 dominant colors gave
   *   rgb(231, 18, 54) / #e71236 — consistent with the logo sample within
   *   normal PNG/anti-aliasing noise.
   * - No SVG, vector master, or documented style guide exists anywhere in
   *   this repository to sample instead. A raster favicon/logo PNG is not
   *   an official brand specification — this ramp must be treated as a
   *   candidate pending explicit design/brand sign-off, not a confirmed
   *   Erve brand color. (THEME-01: prepared for approval, not activated.)
   *
   * Ramp steps (derived from the #e21838 base by mixing toward white for
   * lighter steps and toward black for darker steps — same tint/shade
   * technique `colorTokens`' other scales appear to follow). Every
   * contrast ratio below was computed with the standard WCAG relative-
   * luminance formula against the specific surface named, not eyeballed.
   *
   * — Approved for application use as of this batch (THEME-02/05): the
   *   `500` (raw logo hue) and `600` (solid-fill primary) base values
   *   below have been explicitly approved. `50/100/200/300/400/700/800`
   *   are consistently derived from that approved `500` base using the
   *   same tint/shade technique and were not independently re-sampled —
   *   they inherit the same "candidate, not brand-guideline" caveat as
   *   the base itself.
   *
   * - `50`  (#fdf1f3) — soft background (e.g. selected-row/soft-accent
   *   fills). Not intended for text.
   * - `100` (#fbdce1) — subtle border (e.g. soft-accent borders,
   *   `primary-border`). Not intended for text.
   * - `200` (#f6b5bf) — reserved; not currently wired to a semantic role.
   *   Kept as a ramp step between `100` and `300` for future use.
   * - `300` (#f08798) — **dark-mode primary link / foreground accent.**
   *   Contrast against the dark theme's surfaces: 8.27:1 on app
   *   background `#020617`, 7.32:1 on mid surface `#0f172a`, 6.00:1 on
   *   raised surface `#1e293b` — clears the 4.5:1 normal-text threshold
   *   on all three with real margin. `400` was evaluated first but fails
   *   against the raised surface (3.92:1 < 4.5:1), so `300` is the
   *   correct step for this role, not `400`.
   * - `400` (#e84b64) — **dark-mode focus border/ring.** Contrast against
   *   the same three dark surfaces: 5.41:1 / 4.79:1 / 3.92:1 — all clear
   *   the 3:1 non-text/UI-boundary threshold (focus indicators use 3:1,
   *   not 4.5:1, so `400`'s sub-4.5 result against the raised surface is
   *   not a failure for this specific role).
   * - `500` (#e21838) — raw logo hue / brand reference. Contrast vs.
   *   white text ~4.75:1 (usable as a light-mode foreground color, but
   *   see `600` below for solid fills) and vs. the dark app background
   *   `#020617` ~4.25:1 (does *not* clear 4.5:1 as dark-mode text — do
   *   not use this step for dark-mode foreground/link text; use `300`).
   * - `600` (#c21530) — **approved solid-fill primary**, used as the
   *   `--erp-color-primary` background in both light and dark mode
   *   (contrast vs. white text ~6.09:1 in either mode, since a solid
   *   button's internal contrast doesn't depend on the surrounding page
   *   background). Also used for `--erp-border-focus`/link-adjacent
   *   roles on light surfaces (~5.72–6.09:1 against light page/white).
   * - `700` (#9e1127) — hover step for the solid primary; also reused as
   *   the light-mode link/foreground-accent color (~7.69–8.18:1 against
   *   light surfaces), mirroring the pre-existing convention where
   *   `--erp-text-link` aliased the theme's hover shade.
   * - `800` (#7f0d1f) — active/pressed step; strong emphasis.
   *
   * `200` is included to keep the ramp's step sequence complete/future-
   * proof but has no consumer as of this batch — documented here rather
   * than silently omitted.
   */
  50: "#fdf1f3",
  100: "#fbdce1",
  200: "#f6b5bf",
  300: "#f08798",
  400: "#e84b64",
  500: "#e21838",
  600: "#c21530",
  700: "#9e1127",
  800: "#7f0d1f",
} as const;

export const semanticColorTokens = {
  background: {
    app: colorTokens.neutral[50],
    surface: colorTokens.white,
    raised: colorTokens.white,
    inverse: colorTokens.neutral[900],
  },
  foreground: {
    default: colorTokens.neutral[900],
    subtle: colorTokens.neutral[600],
    muted: colorTokens.neutral[500],
    inverse: colorTokens.white,
  },
  border: {
    default: colorTokens.neutral[200],
    strong: colorTokens.neutral[300],
    focus: colorTokens.blue[600],
  },
  muted: {
    background: colorTokens.neutral[100],
    foreground: colorTokens.neutral[600],
    border: colorTokens.neutral[200],
  },
  info: {
    background: colorTokens.blue[50],
    foreground: colorTokens.blue[700],
    border: colorTokens.blue[100],
    accent: colorTokens.blue[600],
  },
  success: {
    background: colorTokens.green[50],
    foreground: colorTokens.green[700],
    border: colorTokens.green[100],
    accent: colorTokens.green[600],
  },
  warning: {
    background: colorTokens.amber[50],
    foreground: colorTokens.amber[700],
    border: colorTokens.amber[100],
    accent: colorTokens.amber[600],
  },
  danger: {
    background: colorTokens.red[50],
    foreground: colorTokens.red[700],
    border: colorTokens.red[100],
    accent: colorTokens.red[600],
  },
} as const;

export const surfaceTokens = {
  page: colorTokens.neutral[50],
  panel: colorTokens.white,
  card: colorTokens.white,
  raised: colorTokens.white,
  sunken: colorTokens.neutral[100],
  overlay: "rgb(15 23 42 / 0.55)",
  hover: colorTokens.neutral[50],
  selected: colorTokens.blue[50],
  active: colorTokens.blue[100],
  disabled: colorTokens.neutral[100],
  inverse: colorTokens.neutral[900],
} as const;

export const textTokens = {
  primary: colorTokens.neutral[900],
  secondary: colorTokens.neutral[700],
  muted: colorTokens.neutral[600],
  subtle: colorTokens.neutral[500],
  disabled: colorTokens.neutral[400],
  inverse: colorTokens.white,
  link: colorTokens.blue[700],
  danger: colorTokens.red[700],
  warning: colorTokens.amber[700],
  success: colorTokens.green[700],
  info: colorTokens.blue[700],
} as const;

export const borderTokens = {
  default: colorTokens.neutral[200],
  muted: colorTokens.neutral[100],
  strong: colorTokens.neutral[300],
  focus: colorTokens.blue[600],
  danger: colorTokens.red[100],
  warning: colorTokens.amber[100],
  success: colorTokens.green[100],
  selected: colorTokens.blue[100],
  disabled: colorTokens.neutral[200],
} as const;

export const stateTokens = {
  hover: colorTokens.neutral[50],
  active: colorTokens.blue[100],
  selected: colorTokens.blue[50],
  focus: "rgb(37 99 235 / 0.28)",
  disabled: colorTokens.neutral[100],
  readonly: colorTokens.neutral[50],
  loading: colorTokens.blue[50],
  dragging: colorTokens.blue[50],
  blocked: colorTokens.red[50],
  locked: colorTokens.neutral[100],
  new: colorTokens.green[50],
  dirty: colorTokens.amber[50],
  deleted: colorTokens.red[50],
  stale: colorTokens.blue[50],
  error: colorTokens.red[50],
  warning: colorTokens.amber[50],
  saving: colorTokens.blue[50],
  dirtyBorder: colorTokens.amber[100],
  deletedBorder: colorTokens.red[100],
  errorBorder: colorTokens.red[100],
  warningBorder: colorTokens.amber[100],
  staleBorder: colorTokens.blue[100],
} as const;

export const validationTokens = {
  info: {
    bg: colorTokens.blue[50],
    text: colorTokens.blue[700],
    border: colorTokens.blue[100],
    icon: colorTokens.blue[600],
  },
  warning: {
    bg: colorTokens.amber[50],
    text: colorTokens.amber[700],
    border: colorTokens.amber[100],
    icon: colorTokens.amber[600],
  },
  error: {
    bg: colorTokens.red[50],
    text: colorTokens.red[700],
    border: colorTokens.red[100],
    icon: colorTokens.red[600],
  },
  blocking: {
    bg: colorTokens.red[50],
    text: colorTokens.red[700],
    border: colorTokens.red[100],
    icon: colorTokens.red[600],
  },
} as const;

export const gridTokens = {
  header: {
    bg: colorTokens.neutral[50],
    text: colorTokens.neutral[600],
    border: colorTokens.neutral[200],
  },
  row: {
    bg: colorTokens.white,
    altBg: colorTokens.neutral[50],
    hoverBg: colorTokens.blue[50],
    selectedBg: colorTokens.blue[50],
    newBg: colorTokens.green[50],
    dirtyBg: colorTokens.amber[50],
    deletedBg: colorTokens.red[50],
    errorBg: colorTokens.red[50],
    warningBg: colorTokens.amber[50],
    staleBg: colorTokens.blue[50],
    readonlyBg: colorTokens.neutral[50],
    border: colorTokens.neutral[200],
  },
  cell: {
    bg: colorTokens.white,
    editingBg: colorTokens.blue[100],
    focusRing: "rgb(37 99 235 / 0.28)",
    readonlyBg: colorTokens.neutral[50],
    errorBg: colorTokens.red[50],
    warningBg: colorTokens.amber[50],
    staleBg: colorTokens.blue[50],
    pinnedBg: colorTokens.neutral[50],
  },
  footer: {
    bg: colorTokens.neutral[50],
    text: colorTokens.neutral[900],
  },
  totalRow: {
    bg: colorTokens.neutral[50],
  },
  groupRow: {
    bg: colorTokens.neutral[50],
  },
  resizeHandle: colorTokens.neutral[300],
  selectionHandle: colorTokens.blue[600],
} as const;

export const shellTokens = {
  topbar: {
    height: "48px",
  },
  sidebar: {
    width: "16rem",
    collapsedWidth: "4rem",
  },
  footer: {
    height: "48px",
  },
  mobileHeader: {
    height: "48px",
  },
  mobileBottomNav: {
    height: "64px",
  },
  mobileBottomBar: {
    height: "64px",
  },
  workspaceTabs: {
    height: "48px",
  },
  content: {
    maxWidth: "80rem",
    padding: "1.5rem",
    gap: "0.75rem",
  },
  panel: {
    padding: "1.5rem",
    gap: "1rem",
  },
  splitPane: {
    minWidth: "18rem",
    dividerWidth: "1px",
  },
} as const;

export const formTokens = {
  label: {
    width: "10rem",
    gap: "0.5rem",
    color: colorTokens.neutral[900],
    requiredColor: colorTokens.red[700],
  },
  field: {
    gap: "0.5rem",
    inlineGap: "0.75rem",
    helpTextColor: colorTokens.neutral[500],
    errorTextColor: colorTokens.red[700],
    disabledBg: colorTokens.neutral[50],
    readonlyBg: colorTokens.neutral[50],
    border: colorTokens.neutral[300],
    errorBorder: colorTokens.red[100],
    focusBorder: colorTokens.blue[600],
  },
  section: {
    gap: "1rem",
    padding: "1.5rem",
    border: colorTokens.neutral[200],
  },
  error: {
    gap: "0.25rem",
  },
  requiredMarker: {
    color: colorTokens.red[700],
  },
} as const;

export const sizingTokens = {
  intent: {
    hug: "max-content",
    fill: "100%",
    fit: "fit-content",
  },
  control: {
    xs: "6rem",
    sm: "8rem",
    md: "12rem",
    lg: "16rem",
    xl: "24rem",
  },
} as const;

export const typographyTokens = {
  fontFamily: {
    sans: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
    mono: "\"SFMono-Regular\", Consolas, \"Liberation Mono\", Menlo, monospace",
  },
  fontSize: {
    xs: "0.75rem",
    sm: "0.875rem",
    md: "1rem",
    lg: "1.125rem",
    xl: "1.25rem",
    "2xl": "1.5rem",
  },
  lineHeight: {
    tight: "1.2",
    dense: "1.25",
    normal: "1.5",
    relaxed: "1.65",
  },
  fontWeight: {
    regular: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
  },
} as const;

export const spacingTokens = {
  0: "0",
  0.5: "0.125rem",
  1: "0.25rem",
  1.5: "0.375rem",
  2: "0.5rem",
  2.5: "0.625rem",
  3: "0.75rem",
  4: "1rem",
  5: "1.25rem",
  6: "1.5rem",
  8: "2rem",
  10: "2.5rem",
  12: "3rem",
  16: "4rem",
} as const;

export const radiusTokens = {
  none: "0",
  xs: "0.125rem",
  sm: "0.25rem",
  md: "0.375rem",
  lg: "0.5rem",
  xl: "0.75rem",
  full: "9999px",
} as const;

export const shadowTokens = {
  none: "none",
  xs: "0 1px 2px rgb(15 23 42 / 0.06)",
  sm: "0 1px 3px rgb(15 23 42 / 0.12), 0 1px 2px rgb(15 23 42 / 0.08)",
  md: "0 4px 12px rgb(15 23 42 / 0.12)",
  lg: "0 12px 24px rgb(15 23 42 / 0.14)",
  focus: "0 0 0 3px rgb(37 99 235 / 0.28)",
} as const;

/**
 * Legacy density tokens using a desktop/mobile device-category shape.
 * Predates the unified CSS data-density attribute and does not include the
 * touch mode, grid cell sizing, or table padding tokens.
 * See `platformDensityTokens` for the CSS-aligned structure.
 */
export const densityTokens = {
  desktop: {
    compact: {
      controlHeight: "2rem",
      gridRowHeight: "2rem",
      pagePadding: spacingTokens[4],
      sectionGap: spacingTokens[3],
    },
    comfortable: {
      controlHeight: "2.25rem",
      gridRowHeight: "2.25rem",
      pagePadding: spacingTokens[6],
      sectionGap: spacingTokens[4],
    },
  },
  mobile: {
    compact: {
      controlHeight: "2.5rem",
      touchTarget: "2.75rem",
      pagePadding: spacingTokens[4],
      sectionGap: spacingTokens[4],
    },
    comfortable: {
      controlHeight: "2.75rem",
      touchTarget: "3rem",
      pagePadding: spacingTokens[5],
      sectionGap: spacingTokens[5],
    },
  },
} as const;

/**
 * Platform density tokens keyed by CSS data-density attribute value.
 * These map 1:1 to [data-density="compact|comfortable|touch"] in theme.css.
 *
 * Grid tokens are for editable/spreadsheet interaction surfaces (EditableGrid).
 * Table tokens are for read-only dense data display (DenseTableCard and similar).
 * The two sets are intentionally different — do not unify their padding values.
 *
 * SHAPE MISMATCH NOTE: `densityTokens` above uses a desktop/mobile ×
 * compact/comfortable matrix that does not include touch mode or grid/table
 * sizing. The two exports are kept separate; do not try to merge them.
 */
export const platformDensityTokens = {
  compact: {
    grid: {
      cellHeight: "24px",
      headerHeight: "28px",
      cellPaddingX: "4px",
      cellPaddingY: "1px",
    },
    table: {
      cellPaddingX: "12px",
      cellPaddingY: "8px",
      headerPaddingY: "6px",
    },
  },
  comfortable: {
    grid: {
      cellHeight: "28px",
      headerHeight: "32px",
      cellPaddingX: "6px",
      cellPaddingY: "2px",
    },
    table: {
      cellPaddingX: "16px",
      cellPaddingY: "10px",
      headerPaddingY: "8px",
    },
  },
  touch: {
    grid: {
      cellHeight: "36px",
      headerHeight: "40px",
      cellPaddingX: "8px",
      cellPaddingY: "4px",
    },
    table: {
      cellPaddingX: "16px",
      cellPaddingY: "12px",
      headerPaddingY: "10px",
    },
  },
} as const;

export const statusTokens = {
  draft: {
    semantic: "muted",
    label: "Draft",
  },
  submitted: {
    semantic: "info",
    label: "Submitted",
  },
  pendingApproval: {
    semantic: "warning",
    label: "Pending approval",
  },
  approved: {
    semantic: "success",
    label: "Approved",
  },
  rejected: {
    semantic: "danger",
    label: "Rejected",
  },
  posted: {
    semantic: "success",
    label: "Posted",
  },
  cancelled: {
    semantic: "muted",
    label: "Cancelled",
  },
  completed: {
    semantic: "success",
    label: "Completed",
  },
  onHold: {
    semantic: "warning",
    label: "On hold",
  },
  failed: {
    semantic: "danger",
    label: "Failed",
  },
} as const satisfies Record<
  string,
  {
    semantic: keyof Pick<
      typeof semanticColorTokens,
      "muted" | "info" | "success" | "warning" | "danger"
    >;
    label: string;
  }
>;

export const zIndexTokens = {
  base: 0,
  raised: 10,
  sticky: 100,
  header: 200,
  overlay: 400,
  popover: 500,
  toast: 600,
  modal: 700,
  tooltip: 800,
} as const;

export type ColorTokens = typeof colorTokens;
/** Provisional — see the doc comment on `crimsonTokens`. */
export type CrimsonTokens = typeof crimsonTokens;
export type SemanticColorTokens = typeof semanticColorTokens;
export type SurfaceTokens = typeof surfaceTokens;
export type TextTokens = typeof textTokens;
export type BorderTokens = typeof borderTokens;
export type StateTokens = typeof stateTokens;
export type ValidationTokens = typeof validationTokens;
export type GridTokens = typeof gridTokens;
export type ShellTokens = typeof shellTokens;
export type FormTokens = typeof formTokens;
export type SizingTokens = typeof sizingTokens;
export type TypographyTokens = typeof typographyTokens;
export type SpacingTokens = typeof spacingTokens;
export type RadiusTokens = typeof radiusTokens;
export type ShadowTokens = typeof shadowTokens;
export type DensityTokens = typeof densityTokens;
export type PlatformDensityTokens = typeof platformDensityTokens;
export type PlatformDensityMode = keyof PlatformDensityTokens;
export type StatusTokens = typeof statusTokens;
export type ZIndexTokens = typeof zIndexTokens;

export type SemanticColorName = keyof SemanticColorTokens;
export type SurfaceTokenName = keyof SurfaceTokens;
export type TextTokenName = keyof TextTokens;
export type BorderTokenName = keyof BorderTokens;
export type StateTokenName = keyof StateTokens;
export type ValidationSeverityName = keyof ValidationTokens;
export type GridTokenGroupName = keyof GridTokens;
export type ShellTokenGroupName = keyof ShellTokens;
export type FormTokenGroupName = keyof FormTokens;
export type SizingIntent = keyof SizingTokens["intent"];
export type ControlWidth = keyof SizingTokens["control"];
export type WidthMode = SizingIntent | ControlWidth;
export type WorkflowStatusName = keyof StatusTokens;
export type ShellDensityName = keyof DensityTokens;
