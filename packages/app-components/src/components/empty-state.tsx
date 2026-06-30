import { type ReactNode } from "react";
import { cn } from "@erve/primitives";

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
}

export const EmptyState = ({
  title,
  description,
  icon,
  primaryAction,
  secondaryAction,
  className,
}: EmptyStateProps) => (
  <div
    className={cn(
      "flex flex-col items-center justify-center gap-3 py-16 px-6 text-center",
      className,
    )}
  >
    {icon && (
      <div className="flex h-12 w-12 items-center justify-center rounded-card bg-[var(--erp-color-primary-soft)] text-[var(--erp-color-primary)]">
        {icon}
      </div>
    )}
    <div className="flex flex-col gap-1">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm">{description}</p>
      )}
    </div>
    {(primaryAction || secondaryAction) && (
      <div className="flex items-center gap-2 mt-1">
        {primaryAction}
        {secondaryAction}
      </div>
    )}
  </div>
);

EmptyState.displayName = "EmptyState";
