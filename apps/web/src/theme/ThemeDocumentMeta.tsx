import { useEffect, useRef } from 'react';
import { useTheme } from '@erve/theme';

const THEME_COLOR_META_SELECTOR = 'meta[data-erve-theme-color]';
const APP_BACKGROUND_VARIABLE = '--erp-color-app-bg';

/**
 * Keeps the browser's dynamic `<meta name="theme-color" data-erve-theme-color>`
 * tag (see index.html) in sync with the resolved theme. Deliberately does
 * NOT use media-qualified `theme-color` tags instead — those follow the OS
 * appearance and would be wrong whenever the user explicitly picks a mode
 * that differs from the OS (e.g. explicit dark on a light-OS device).
 */
export function ThemeDocumentMeta(): null {
  const { resolvedTheme } = useTheme();
  const frameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    // ThemeProvider's own marker effect (which applies `.dark`/data-color-mode
    // to <html>) is a separate `useEffect` in a different component — effect
    // ordering across components doesn't guarantee the DOM has been
    // restyled by the time THIS effect body runs, so the CSS-variable read
    // is deferred to the next animation frame.
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
