import * as React from "react";
import { cn } from "@erve/primitives";

export interface TotalsPanelItem {
  label: React.ReactNode;
  value: React.ReactNode;
  description?: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "info";
  emphasis?: "default" | "strong" | "muted";
  dividerBefore?: boolean;
}

export interface TotalsPanelProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  items: readonly TotalsPanelItem[];
  footer?: React.ReactNode;
  density?: "compact" | "comfortable" | "touch";
  align?: "default" | "financial";
}

export const TotalsPanel = React.forwardRef<HTMLDivElement, TotalsPanelProps>(
  (
    { title, description, items, footer, density = "comfortable", align = "financial", className, ...props },
    ref
  ) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col rounded-md border border-border bg-surface p-4",
          density === "compact" && "p-3",
          density === "touch" && "p-5",
          className
        )}
        {...props}
      >
        {(title || description) && (
          <div className="flex flex-col gap-1 mb-4">
            {title && (
              <div className="font-semibold text-foreground text-sm">
                {title}
              </div>
            )}
            {description && (
              <div className="text-sm text-muted">
                {description}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col">
          {items.map((item, idx) => {
            let toneClass = "text-foreground";
            if (item.tone === "success") toneClass = "text-green-700";
            if (item.tone === "warning") toneClass = "text-amber-700";
            if (item.tone === "danger") toneClass = "text-red-700";
            if (item.tone === "info") toneClass = "text-blue-700";

            let emphasisClass = "font-normal";
            if (item.emphasis === "strong") emphasisClass = "font-bold text-base";
            if (item.emphasis === "muted") emphasisClass = "text-muted text-sm";

            return (
              <React.Fragment key={idx}>
                {item.dividerBefore && (
                  <div className="h-px w-full bg-border my-2" />
                )}
                <div
                  className={cn(
                    "flex items-center justify-between gap-4 py-1.5",
                    item.emphasis === "strong" && "py-2"
                  )}
                >
                  <div className="flex flex-col gap-0.5">
                    <span
                      className={cn(
                        "text-sm",
                        item.emphasis === "strong" ? "font-semibold text-foreground" : "text-muted-foreground",
                        item.emphasis === "muted" && "text-muted"
                      )}
                    >
                      {item.label}
                    </span>
                    {item.description && (
                      <span className="text-xs text-muted">
                        {item.description}
                      </span>
                    )}
                  </div>
                  <span
                    className={cn(
                      "text-sm whitespace-nowrap",
                      align === "financial" && "tabular-nums text-right",
                      toneClass,
                      emphasisClass
                    )}
                  >
                    {item.value}
                  </span>
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {footer && (
          <div className="mt-4 pt-4 border-t border-border">
            {footer}
          </div>
        )}
      </div>
    );
  }
);
TotalsPanel.displayName = "TotalsPanel";
