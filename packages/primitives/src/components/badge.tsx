import { cva, type VariantProps } from "class-variance-authority";
import { type HTMLAttributes } from "react";
import { cn } from "../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium leading-none select-none",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--erp-status-draft-bg)] text-[var(--erp-status-draft-fg)] border-[var(--erp-status-draft-border)]",
        success:
          "bg-[var(--erp-status-success-bg)] text-[var(--erp-status-success-fg)] border-[var(--erp-status-success-border)]",
        warning:
          "bg-[var(--erp-status-warning-bg)] text-[var(--erp-status-warning-fg)] border-[var(--erp-status-warning-border)]",
        danger:
          "bg-[var(--erp-status-danger-bg)] text-[var(--erp-status-danger-fg)] border-[var(--erp-status-danger-border)]",
        info:
          "bg-[var(--erp-status-info-bg)] text-[var(--erp-status-info-fg)] border-[var(--erp-status-info-border)]",
        muted:
          "bg-surface-muted text-muted-foreground border-border-subtle",
      },
      width: {
        hug: "w-[var(--erp-size-intent-hug)] max-w-full",
        fill: "w-[var(--erp-size-intent-fill)]",
        fit: "w-[var(--erp-size-intent-fit)] max-w-full",
      },
    },
    defaultVariants: {
      variant: "default",
      width: "hug",
    },
  },
);

export type BadgeVariant = NonNullable<
  VariantProps<typeof badgeVariants>["variant"]
>;
export type BadgeWidth = NonNullable<VariantProps<typeof badgeVariants>["width"]>;

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = ({ className, variant, width = "hug", ...props }: BadgeProps) => (
  <span
    data-width={width}
    className={cn(badgeVariants({ variant, width }), className)}
    {...props}
  />
);

Badge.displayName = "Badge";
