import { cn } from "@erve/primitives";
import {
  Skeleton,
  SkeletonSubtle,
  SkeletonCard,
} from "@erve/primitives";

export type LoadingVariant = "page" | "inline" | "skeleton";

export interface LoadingStateProps {
  variant?: LoadingVariant;
  label?: string;
  rows?: number;
  className?: string;
}

const Spinner = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={cn("motion-safe:animate-spin", className)}
    fill="none"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
);

// A single skeleton entry: primary shimmer bar + subordinate subtle bar
const SkeletonRow = ({ index }: { index: number }) => {
  const primaryWidths = [75, 63, 82, 57, 70];
  const subtleWidths  = [55, 47, 60, 38, 50];
  return (
    <div className="flex flex-col gap-1">
      <Skeleton
        className="h-3"
        style={{ width: `${primaryWidths[index % primaryWidths.length]}%` }}
      />
      <SkeletonSubtle
        className="h-2"
        style={{ width: `${subtleWidths[index % subtleWidths.length]}%` }}
      />
    </div>
  );
};

export const LoadingState = ({
  variant = "page",
  label = "Loading...",
  rows = 4,
  className,
}: LoadingStateProps) => {
  if (variant === "inline") {
    return (
      <div
        className={cn("flex items-center gap-2 text-muted-foreground", className)}
        role="status"
        aria-label={label}
      >
        <Spinner className="h-4 w-4 text-[var(--erp-text-link)] shrink-0" />
        <span className="text-sm">{label}</span>
      </div>
    );
  }

  if (variant === "skeleton") {
    return (
      <div
        className={cn("flex flex-col gap-3.5 p-4", className)}
        role="status"
        aria-label={label}
      >
        {Array.from({ length: rows }, (_, i) => (
          <SkeletonRow key={i} index={i} />
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-16",
        className,
      )}
      role="status"
      aria-label={label}
    >
      <Spinner className="h-8 w-8 text-[var(--erp-text-link)]" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
};

LoadingState.displayName = "LoadingState";

// Re-export SkeletonCard for consumers who want the composable block directly
export { SkeletonCard };
