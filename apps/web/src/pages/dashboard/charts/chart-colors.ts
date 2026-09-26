// A small, consistent qualitative palette reusing the app's own semantic
// design tokens (light/dark-mode aware automatically, since these are CSS
// custom properties) rather than inventing new hex colors for charts.
export const CHART_SERIES_COLORS = [
  'var(--erp-color-primary)',
  'var(--erp-color-info)',
  'var(--erp-color-success)',
  'var(--erp-color-warning)',
  'var(--erp-color-danger)',
] as const;

export const CHART_MUTED_COLOR = 'var(--erp-color-muted-foreground)';
export const CHART_GRID_COLOR = 'var(--erp-color-border-muted)';
