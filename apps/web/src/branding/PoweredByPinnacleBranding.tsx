import { useTheme } from '@erve/theme';
import { PoweredByPinnacle, type PoweredByPinnacleVariant } from '@erve/app-components';

const LOGO_BY_THEME: Record<'light' | 'dark', string> = {
  light: '/pinnacle-logo-on-light.png',
  dark: '/pinnacle-logo-on-dark.png',
};

// The extracted triangular mark (no wordmark) used for the "compact" variant
// — see apps/mobile/branding/README.md for the crop provenance shared by
// both apps' copies of this asset.
const MARK_BY_THEME: Record<'light' | 'dark', string> = {
  light: '/pinnacle-mark-on-light.png',
  dark: '/pinnacle-mark-on-dark.png',
};

export interface PoweredByPinnacleBrandingProps {
  variant?: PoweredByPinnacleVariant;
  className?: string;
  logoClassName?: string;
}

/**
 * Connects the shared presentational `PoweredByPinnacle` to the shared
 * `ThemeProvider`, picking the light/dark lockup by `resolvedTheme` — mirrors
 * the `ThemeModeMenu` connector pattern. Assets are served from `public/`
 * (same convention as `/erve-logo.png`), not bundled imports. Resolves to a
 * different *asset* per variant, not just a different size: "row" gets the
 * full lockup, "compact" gets the mark-only extraction.
 */
export function PoweredByPinnacleBranding({ variant = 'row', className, logoClassName }: PoweredByPinnacleBrandingProps) {
  const { resolvedTheme } = useTheme();
  const logoSrc = variant === 'compact' ? MARK_BY_THEME[resolvedTheme] : LOGO_BY_THEME[resolvedTheme];

  return <PoweredByPinnacle logoSrc={logoSrc} variant={variant} className={className} logoClassName={logoClassName} />;
}

PoweredByPinnacleBranding.displayName = 'PoweredByPinnacleBranding';
