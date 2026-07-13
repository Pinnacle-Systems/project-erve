import { useTheme } from '@erve/theme';
import { ThemeModeControl } from '@erve/app-components';

const RESOLVED_CAPTION: Record<'light' | 'dark', string> = {
  light: 'Currently light',
  dark: 'Currently dark',
};

/**
 * Mirrors apps/web/src/theme/ThemeModeMenu.tsx — connects the shared
 * presentational ThemeModeControl to the shared ThemeProvider. Holds no
 * state of its own; the provider remains the single owner of selected/
 * resolved mode and persistence.
 */
export function ThemeModeMenu() {
  const { colorMode, resolvedTheme, setColorMode } = useTheme();

  return (
    <ThemeModeControl
      value={colorMode}
      onValueChange={setColorMode}
      systemCaption={RESOLVED_CAPTION[resolvedTheme]}
    />
  );
}

ThemeModeMenu.displayName = 'ThemeModeMenu';
