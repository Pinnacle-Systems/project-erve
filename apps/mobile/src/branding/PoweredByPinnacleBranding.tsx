import { useTheme } from '@erve/theme';
import { PoweredByPinnacle, type PoweredByPinnacleVariant } from '@erve/app-components';
import pinnacleLogoOnDark from '../../branding/pinnacle-logo-on-dark.png';
import pinnacleLogoOnLight from '../../branding/pinnacle-logo-on-light.png';
import pinnacleMarkOnDark from '../../branding/pinnacle-mark-on-dark.png';
import pinnacleMarkOnLight from '../../branding/pinnacle-mark-on-light.png';

const LOGO_BY_THEME: Record<'light' | 'dark', string> = {
  light: pinnacleLogoOnLight,
  dark: pinnacleLogoOnDark,
};

// The extracted triangular mark (no wordmark) used for the "compact" variant
// — see apps/mobile/branding/README.md for the crop provenance.
const MARK_BY_THEME: Record<'light' | 'dark', string> = {
  light: pinnacleMarkOnLight,
  dark: pinnacleMarkOnDark,
};

export interface PoweredByPinnacleBrandingProps {
  variant?: PoweredByPinnacleVariant;
  className?: string;
  logoClassName?: string;
}

/**
 * Connects the shared presentational `PoweredByPinnacle` to the shared
 * `ThemeProvider`, picking the light/dark lockup by `resolvedTheme` — mirrors
 * the `ThemeModeSelector` connector pattern. Assets are bundler-imported from
 * `branding/` (same convention as `erveLogo`), not served from a public path.
 * Resolves to a different *asset* per variant, not just a different size:
 * "row" gets the full lockup, "compact" gets the mark-only extraction.
 */
export function PoweredByPinnacleBranding({ variant = 'row', className, logoClassName }: PoweredByPinnacleBrandingProps) {
  const { resolvedTheme } = useTheme();
  const logoSrc = variant === 'compact' ? MARK_BY_THEME[resolvedTheme] : LOGO_BY_THEME[resolvedTheme];

  return <PoweredByPinnacle logoSrc={logoSrc} variant={variant} className={className} logoClassName={logoClassName} />;
}

PoweredByPinnacleBranding.displayName = 'PoweredByPinnacleBranding';
