import { cn } from "@erve/primitives";

export type PoweredByPinnacleVariant = "row" | "compact";

export interface PoweredByPinnacleProps {
  /** Pre-resolved asset URL/import for the current resolved theme. */
  logoSrc: string;
  /**
   * "row" (default): visible "Powered by" label next to the full
   * "Pinnacle Systems" logo lockup — used wherever there's room for the
   * label (login footers, expanded sidebar, mobile account sheet). The logo
   * is decorative here (`alt=""`) since the adjacent label already conveys
   * the relationship.
   *
   * "compact": the extracted triangular Pinnacle mark only (not the full
   * wordmark shrunk down — that stops being legible below a few dozen
   * pixels), no visible label — used for the collapsed sidebar. Since
   * there's no adjacent visible text, the logo's `alt` must carry the full
   * meaning on its own.
   */
  variant?: PoweredByPinnacleVariant;
  className?: string;
  logoClassName?: string;
}

/**
 * Theme-agnostic presentational component — mirrors the
 * ThemeModeControl/ThemeModeRadioList split: this component takes an
 * already-resolved `logoSrc` as a prop rather than reading `useTheme()`
 * itself, so each app's connector wrapper owns theme resolution and its own
 * asset import convention. Each connector also resolves `logoSrc` to the
 * right *asset* for the variant (full lockup for "row", mark-only for
 * "compact") — this component just renders whatever it's given at a
 * variant-appropriate size.
 */
export function PoweredByPinnacle({
  logoSrc,
  variant = "row",
  className,
  logoClassName,
}: PoweredByPinnacleProps) {
  if (variant === "compact") {
    return (
      <img
        src={logoSrc}
        alt="Powered by Pinnacle Systems"
        className={cn("h-7 w-auto max-w-full", logoClassName, className)}
      />
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Powered by
      </span>
      <img src={logoSrc} alt="" className={cn("h-6 w-auto max-w-full", logoClassName)} />
    </div>
  );
}

PoweredByPinnacle.displayName = "PoweredByPinnacle";
