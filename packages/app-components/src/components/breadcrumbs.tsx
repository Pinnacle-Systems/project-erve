import { type MouseEvent } from "react";
import { cn } from "@erve/primitives";

export interface BreadcrumbItem {
  id: string;
  label: string;
  href?: string;
  onClick?: () => void;
  current?: boolean;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  compact?: boolean;
  maxItems?: number;
  className?: string;
  onNavigate?: (item: BreadcrumbItem) => void;
}

type RenderableBreadcrumb =
  | {
      type: "item";
      item: BreadcrumbItem;
      originalIndex: number;
    }
  | {
      type: "ellipsis";
      id: string;
    };

const getRenderableBreadcrumbs = (
  items: BreadcrumbItem[],
  maxItems?: number,
): RenderableBreadcrumb[] => {
  const indexedItems = items.map((item, originalIndex) => ({
    type: "item" as const,
    item,
    originalIndex,
  }));

  if (maxItems === undefined || items.length <= maxItems) {
    return indexedItems;
  }

  if (maxItems <= 0) {
    return [];
  }

  if (maxItems === 1) {
    return indexedItems.slice(-1);
  }

  if (maxItems === 2) {
    const first = indexedItems[0];
    const last = indexedItems[indexedItems.length - 1];
    return first && last ? [first, last] : indexedItems;
  }

  const first = indexedItems[0];
  if (!first) {
    return [];
  }

  return [
    first,
    { type: "ellipsis", id: "breadcrumb-overflow" },
    ...indexedItems.slice(-(maxItems - 2)),
  ];
};

export const Breadcrumbs = ({
  items,
  compact = false,
  maxItems,
  className,
  onNavigate,
}: BreadcrumbsProps) => {
  const renderableItems = getRenderableBreadcrumbs(items, maxItems);

  if (renderableItems.length === 0) {
    return null;
  }

  const handleClick = (event: MouseEvent<HTMLAnchorElement | HTMLButtonElement>, item: BreadcrumbItem) => {
    if (item.onClick || onNavigate) {
      event.preventDefault();
      if (item.onClick) {
        item.onClick();
      } else {
        onNavigate?.(item);
      }
    }
  };

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn(
        "flex min-w-0 items-center",
        compact ? "gap-1 text-xs" : "gap-1.5 text-sm",
        className,
      )}
    >
      <ol className={cn("flex min-w-0 items-center", compact ? "gap-1" : "gap-1.5")}>
        {renderableItems.map((renderableItem, renderIndex) => {
          const showSeparator = renderIndex > 0;

          if (renderableItem.type === "ellipsis") {
            return (
              <li
                key={renderableItem.id}
                className={cn("flex min-w-0 items-center", compact ? "gap-1" : "gap-1.5")}
              >
                {showSeparator && <BreadcrumbSeparator />}
                <span
                  aria-hidden="true"
                  className="select-none text-muted-foreground"
                >
                  ...
                </span>
              </li>
            );
          }

          const { item, originalIndex } = renderableItem;
          const isCurrent = item.current ?? originalIndex === items.length - 1;
          const interactive = Boolean(item.href || item.onClick || onNavigate);
          const itemClassName = cn(
            "min-w-0 max-w-48 truncate rounded-xs outline-hidden transition-colors",
            compact ? "px-0.5 py-0" : "px-1 py-0.5",
            isCurrent
              ? "font-medium text-foreground"
              : "text-muted-foreground",
            interactive && !isCurrent && "hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--erp-focus-ring)]",
          );

          return (
            <li
              key={item.id}
              className={cn("flex min-w-0 items-center", compact ? "gap-1" : "gap-1.5")}
            >
              {showSeparator && <BreadcrumbSeparator />}
              {item.href ? (
                <a
                  href={item.href}
                  aria-current={isCurrent ? "page" : undefined}
                  onClick={(event) => handleClick(event, item)}
                  className={itemClassName}
                >
                  {item.label}
                </a>
              ) : interactive ? (
                <button
                  type="button"
                  aria-current={isCurrent ? "page" : undefined}
                  onClick={(event) => handleClick(event, item)}
                  className={cn("bg-transparent text-left", itemClassName)}
                >
                  {item.label}
                </button>
              ) : (
                <span
                  aria-current={isCurrent ? "page" : undefined}
                  className={itemClassName}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

const BreadcrumbSeparator = () => (
  <span
    aria-hidden="true"
    className="select-none text-muted-foreground"
  >
    /
  </span>
);

Breadcrumbs.displayName = "Breadcrumbs";
