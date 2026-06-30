import * as React from "react";
import { cn } from "@erve/primitives";

export interface AuditTrailItem {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  actor?: React.ReactNode;
  timestamp?: React.ReactNode;
  tone?: "default" | "info" | "success" | "warning" | "danger";
  metadata?: React.ReactNode;
  icon?: React.ReactNode;
}

export interface AuditTrailProps extends Omit<React.HTMLAttributes<HTMLOListElement>, "items"> {
  items: readonly AuditTrailItem[];
  density?: "compact" | "comfortable" | "touch";
  emptyState?: React.ReactNode;
}

const toneMap = {
  default: "bg-surface-alt border-border text-foreground",
  info: "bg-blue-50 border-blue-200 text-blue-900",
  success: "bg-green-50 border-green-200 text-green-900",
  warning: "bg-amber-50 border-amber-200 text-amber-900",
  danger: "bg-red-50 border-red-200 text-red-900",
};

export const AuditTrail = React.forwardRef<HTMLOListElement, AuditTrailProps>(
  ({ items, density = "comfortable", emptyState, className, ...props }, ref) => {
    if (items.length === 0) {
      return (
        <div className={cn("text-muted text-sm italic py-4", className)}>
          {emptyState ?? "No history available."}
        </div>
      );
    }

    return (
      <ol
        ref={ref}
        className={cn(
          "relative border-l border-border ml-3 space-y-6",
          density === "compact" && "space-y-4",
          density === "touch" && "space-y-8",
          className
        )}
        {...props}
      >
        {items.map((item) => {
          const toneClass = toneMap[item.tone ?? "default"];
          return (
            <li key={item.id} className="ml-6">
              <span
                className={cn(
                  "absolute flex items-center justify-center w-6 h-6 rounded-full -left-3 ring-4 ring-surface border",
                  toneClass
                )}
              >
                {item.icon ?? <div className="w-2 h-2 rounded-full bg-current opacity-50" />}
              </span>
              <div className="flex flex-col gap-1">
                <div className="flex items-start justify-between gap-4">
                  <div className="text-sm font-medium text-foreground">{item.title}</div>
                  {item.timestamp && (
                    <time className="text-xs text-muted whitespace-nowrap">
                      {item.timestamp}
                    </time>
                  )}
                </div>
                {item.actor && (
                  <div className="text-xs font-medium text-foreground">{item.actor}</div>
                )}
                {item.description && (
                  <div className="text-sm text-muted mt-1 leading-relaxed">
                    {item.description}
                  </div>
                )}
                {item.metadata && <div className="mt-2">{item.metadata}</div>}
              </div>
            </li>
          );
        })}
      </ol>
    );
  }
);
AuditTrail.displayName = "AuditTrail";
