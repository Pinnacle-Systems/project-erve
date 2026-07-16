import { useTheme } from '@erve/theme';
import { ThemeModeRadioList } from '@erve/app-components';

const RESOLVED_CAPTION: Record<'light' | 'dark', string> = {
  light: 'Currently light',
  dark: 'Currently dark',
};

/**
 * Connects the shared presentational `ThemeModeRadioList` to the shared
 * `ThemeProvider` — the provider remains the single owner of selected/
 * resolved mode and persistence; this component holds no state of its own.
 *
 * Renders inline (no popover trigger), unlike apps/web's `ThemeModeMenu`
 * (which wraps the anchored-popover `ThemeModeControl`): mobile embeds this
 * inside the account bottom sheet, where a second floating menu stacked on
 * top of the sheet would be poor touch UX.
 */
export function ThemeModeSelector() {
  const { colorMode, resolvedTheme, setColorMode } = useTheme();

  return (
    <ThemeModeRadioList
      value={colorMode}
      onValueChange={setColorMode}
      systemCaption={RESOLVED_CAPTION[resolvedTheme]}
    />
  );
}

ThemeModeSelector.displayName = 'ThemeModeSelector';
