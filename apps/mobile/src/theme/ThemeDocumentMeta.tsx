import { useEffect, useRef } from 'react';
import { useTheme } from '@erve/theme';

const THEME_COLOR_META_SELECTOR = 'meta[data-erve-theme-color]';
const APP_BACKGROUND_VARIABLE = '--erp-color-app-bg';

/**
 * Mobile-local twin of apps/web/src/theme/ThemeDocumentMeta.tsx. Not moved
 * into a shared package because @erve/theme already takes a devDependency on
 * @erve/app-components for its own tests — adding a runtime dependency in
 * the other direction would create a workspace dependency cycle. Keep this
 * file's logic in sync with the web copy; low priority on Capacitor (there
 * is no browser chrome to color) but kept for consistency, see Part 10 of
 * the mobile theme task.
 */
export function ThemeDocumentMeta(): null {
  const { resolvedTheme } = useTheme();
  const frameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    frameRef.current = window.requestAnimationFrame(() => {
      const meta = document.querySelector<HTMLMetaElement>(THEME_COLOR_META_SELECTOR);
      if (!meta) {
        return;
      }

      const value = window
        .getComputedStyle(document.documentElement)
        .getPropertyValue(APP_BACKGROUND_VARIABLE)
        .trim();

      if (value) {
        meta.setAttribute('content', value);
      }
    });

    return () => {
      if (frameRef.current !== undefined) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, [resolvedTheme]);

  return null;
}

ThemeDocumentMeta.displayName = 'ThemeDocumentMeta';
