import * as React from "react";
import { cn } from "@erve/primitives";
import { Button } from "@erve/primitives";
import { StatusBadge } from "./status-badge";

export interface ApprovalActionConfig {
  key: string;
  label: React.ReactNode;
  tone?: "default" | "success" | "danger" | "warning";
  variant?: "primary" | "secondary" | "ghost" | "default";
  disabled?: boolean;
  loading?: boolean;
  requiresComment?: boolean;
}

export interface ApprovalActionBarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onAction"> {
  status?: React.ReactNode;
  statusTone?: "default" | "info" | "success" | "warning" | "danger";
  message?: React.ReactNode;
  actions: readonly ApprovalActionConfig[];
  onAction?: (action: ApprovalActionConfig) => void;
  density?: "compact" | "comfortable" | "touch";
}

export const ApprovalActionBar = React.forwardRef<HTMLDivElement, ApprovalActionBarProps>(
  (
    { status, statusTone = "default", message, actions, onAction, density = "comfortable", className, ...props },
    ref
  ) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-wrap items-center justify-between gap-4 p-4 border-t border-border bg-surface",
          density === "compact" && "p-3",
          density === "touch" && "p-5",
          className
        )}
        {...props}
      >
        <div className="flex flex-col gap-1">
          {status && (
            <div className="flex items-center gap-2">
              {typeof status === "string" ? (
                <StatusBadge label={status} tone={statusTone === "info" || statusTone === "danger" ? "default" : statusTone} />
              ) : (
                status
              )}
            </div>
          )}
          {message && <p className="text-sm text-muted-foreground">{message}</p>}
        </div>

        <div className="flex items-center gap-3">
          {actions.map((action) => {
            // Map our action properties to Button properties
            let buttonVariant: "default" | "secondary" | "ghost" | "destructive" = "default";
            if (action.variant === "ghost") buttonVariant = "ghost";
            if (action.variant === "secondary") buttonVariant = "secondary";
            if (action.tone === "danger") buttonVariant = "destructive";
            if (action.variant === "primary") buttonVariant = "default";

            return (
              <Button
                key={action.key}
                variant={buttonVariant}
                disabled={action.disabled || action.loading}
                onClick={() => onAction?.(action)}
                density={density === "compact" ? "compact" : "comfortable"}
              >
                {action.label}
              </Button>
            );
          })}
        </div>
      </div>
    );
  }
);
ApprovalActionBar.displayName = "ApprovalActionBar";
