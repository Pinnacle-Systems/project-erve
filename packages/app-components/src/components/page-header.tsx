import { type ReactNode } from "react";
import { cn } from "@erve/primitives";
import { Breadcrumbs, type BreadcrumbItem } from "./breadcrumbs";

export type { BreadcrumbItem } from "./breadcrumbs";

export interface MetaItem {
  label: string;
  value: string;
}

export type PageHeaderDensity = "compact" | "comfortable" | "touch";

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: BreadcrumbItem[];
  breadcrumbSlot?: ReactNode;
  status?: ReactNode;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
  meta?: MetaItem[];
  density?: PageHeaderDensity;
  className?: string;
}

export const PageHeader = ({
  title,
  subtitle,
  breadcrumbs,
  breadcrumbSlot,
  status,
  primaryAction,
  secondaryActions,
  meta,
  density = "comfortable",
  className,
}: PageHeaderProps) => (
  <div
    className={cn(
      "bg-surface border-b border-border-subtle",
      density === "compact" && "px-4 py-2",
      density === "comfortable" && "px-6 py-4",
      density === "touch" && "px-5 py-5",
      className,
    )}
  >
    {breadcrumbSlot ? (
      <div className="mb-1.5 min-w-0 text-xs text-muted-foreground">
        {breadcrumbSlot}
      </div>
    ) : breadcrumbs && breadcrumbs.length > 0 ? (
      <Breadcrumbs items={breadcrumbs} compact className="mb-1.5" />
    ) : null}

    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h1
            className={cn(
              "font-semibold text-foreground leading-tight",
              density === "compact" && "text-sm",
              density === "comfortable" && "text-base",
              density === "touch" && "text-lg",
            )}
          >
            {title}
          </h1>
          {status && <div className="flex items-center shrink-0">{status}</div>}
        </div>
        {subtitle && (
          <p
            className={cn(
              "text-muted-foreground mt-0.5 truncate",
              density === "compact" ? "text-xs" : "text-sm",
            )}
          >
            {subtitle}
          </p>
        )}
      </div>

      {(secondaryActions || primaryAction) && (
        <div className="flex items-center gap-2 shrink-0 pt-0.5">
          {secondaryActions}
          {primaryAction}
        </div>
      )}
    </div>

    {meta && meta.length > 0 && (
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5">
        {meta.map((item, i) => (
          <span key={i} className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{item.label}:</span>{" "}
            {item.value}
          </span>
        ))}
      </div>
    )}
  </div>
);

PageHeader.displayName = "PageHeader";
