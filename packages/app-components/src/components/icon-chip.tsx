import { type ReactNode } from "react";
import { cn } from "@erve/primitives";

export type IconChipTone = "primary" | "success" | "warning" | "danger" | "info" | "neutral";
export type IconChipSize = "sm" | "md";

export interface IconChipProps {
  icon: ReactNode;
  tone?: IconChipTone;
  size?: IconChipSize;
  className?: string;
}

const chipToneClass: Record<IconChipTone, string> = {
  primary: "bg-[var(--erp-color-primary-soft)] text-[var(--erp-text-accent)]",
  success: "bg-[var(--erp-status-success-bg)] text-[var(--erp-status-success-fg)]",
  warning: "bg-[var(--erp-status-warning-bg)] text-[var(--erp-status-warning-fg)]",
  danger: "bg-[var(--erp-status-danger-bg)] text-[var(--erp-status-danger-fg)]",
  info: "bg-[var(--erp-status-info-bg)] text-[var(--erp-status-info-fg)]",
  neutral: "bg-[var(--erp-surface-muted)] text-muted-foreground",
};

const chipSizeClass: Record<IconChipSize, string> = {
  sm: "h-7 w-7 rounded-control",
  md: "h-10 w-10 rounded-card",
};

export const IconChip = ({
  icon,
  tone = "primary",
  size = "md",
  className,
}: IconChipProps) => (
  <div
    data-component="IconChip"
    className={cn(
      "flex shrink-0 items-center justify-center",
      chipToneClass[tone],
      chipSizeClass[size],
      className,
    )}
    aria-hidden="true"
  >
    {icon}
  </div>
);

IconChip.displayName = "IconChip";
