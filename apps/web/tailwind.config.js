/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
    '../../packages/primitives/src/**/*.{ts,tsx}',
    '../../packages/layout/src/**/*.{ts,tsx}',
    '../../packages/app-components/src/**/*.{ts,tsx}',
    '../../packages/data-display/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--erp-color-background)',
        foreground: 'var(--erp-color-foreground)',
        primary: {
          DEFAULT: 'var(--erp-color-primary)',
          hover: 'var(--erp-color-primary-hover)',
          foreground: 'var(--erp-color-primary-foreground)',
        },
        surface: {
          DEFAULT: 'var(--erp-color-surface)',
          muted: 'var(--erp-color-surface-muted)',
          raised: 'var(--erp-color-surface-raised)',
        },
        muted: {
          DEFAULT: 'var(--erp-color-muted)',
          foreground: 'var(--erp-color-muted-foreground)',
        },
        border: {
          DEFAULT: 'var(--erp-color-border)',
          subtle: 'var(--erp-color-border-muted)',
          strong: 'var(--erp-color-border-strong)',
        },
        danger: {
          DEFAULT: 'var(--erp-color-danger)',
          foreground: 'var(--erp-color-danger-foreground)',
        },
        warning: {
          DEFAULT: 'var(--erp-color-warning)',
          foreground: 'var(--erp-color-warning-foreground)',
        },
        success: {
          DEFAULT: 'var(--erp-color-success)',
          foreground: 'var(--erp-color-success-foreground)',
        },
        info: {
          DEFAULT: 'var(--erp-color-info)',
          foreground: 'var(--erp-color-info-foreground)',
        },
      },
      borderRadius: {
        control: 'var(--erp-radius-control)',
        card: 'var(--erp-radius-card)',
        panel: 'var(--erp-radius-panel)',
      },
      boxShadow: {
        card: 'var(--erp-shadow-card)',
        panel: 'var(--erp-shadow-md)',
        popover: 'var(--erp-shadow-floating)',
        control: 'var(--erp-shadow-sm)',
      },
      fontSize: {
        control: 'var(--erp-control-font-size)',
        label: 'var(--erp-font-size-sm)',
        data: 'var(--erp-font-size-sm)',
      },
      height: {
        control: 'var(--erp-control-height)',
      },
    },
  },
  plugins: [],
};
