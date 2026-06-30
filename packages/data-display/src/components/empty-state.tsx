import { forwardRef, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const emptyStateVariants = cva(
  "flex flex-col items-center justify-center text-center p-6",
  {
    variants: {
      density: {
        compact: "gap-2 py-6",
        comfortable: "gap-4 py-12",
        touch: "gap-6 py-16",
      },
      tone: {
        default: "text-muted-foreground",
        search: "text-muted-foreground",
        error: "text-danger",
        permission: "text-warning",
      },
    },
    defaultVariants: {
      density: "comfortable",
      tone: "default",
    },
  }
);

export interface EmptyStateProps extends VariantProps<typeof emptyStateVariants> {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ className, density, tone, title, description, action, ...props }, ref) => {
    return (
      <div ref={ref} className={cn(emptyStateVariants({ density, tone }), className)} {...props}>
        <div className="flex flex-col gap-1.5 items-center">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          {description && (
            <p className={cn("text-sm", tone === "error" ? "text-danger" : "text-muted-foreground")}>
              {description}
            </p>
          )}
        </div>
        {action && <div className="mt-2">{action}</div>}
      </div>
    );
  }
);
EmptyState.displayName = "EmptyState";
