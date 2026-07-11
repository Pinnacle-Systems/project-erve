import * as React from "react";
import { cn } from "@erve/primitives";
import { Button } from "@erve/primitives";

export interface AttachmentItem {
  id: string;
  name: React.ReactNode;
  size?: React.ReactNode;
  type?: React.ReactNode;
  uploadedBy?: React.ReactNode;
  uploadedAt?: React.ReactNode;
  status?: "uploaded" | "pending" | "failed";
  metadata?: React.ReactNode;
}

export interface AttachmentListProps extends Omit<React.HTMLAttributes<HTMLUListElement>, "items"> {
  items: readonly AttachmentItem[];
  density?: "compact" | "comfortable" | "touch";
  emptyState?: React.ReactNode;
  onView?: (item: AttachmentItem) => void;
  onDownload?: (item: AttachmentItem) => void;
  onRemove?: (item: AttachmentItem) => void;
}

export const AttachmentList = React.forwardRef<HTMLUListElement, AttachmentListProps>(
  (
    { items, density = "comfortable", emptyState, onView, onDownload, onRemove, className, ...props },
    ref
  ) => {
    if (items.length === 0) {
      return (
        <div className={cn("text-muted text-sm italic py-4", className)}>
          {emptyState ?? "No attachments."}
        </div>
      );
    }

    return (
      <ul
        ref={ref}
        className={cn(
          "flex flex-col gap-2",
          density === "compact" && "gap-1",
          density === "touch" && "gap-3",
          className
        )}
        {...props}
      >
        {items.map((item) => (
          <li
            key={item.id}
            className={cn(
              "flex items-center justify-between gap-4 p-3 rounded-md border border-border bg-surface",
              item.status === "failed" && "border-red-200 bg-red-50",
              density === "compact" && "p-2",
              density === "touch" && "p-4"
            )}
          >
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "text-sm font-medium text-foreground truncate",
                    item.status === "failed" && "text-red-900"
                  )}
                  title={typeof item.name === "string" ? item.name : undefined}
                >
                  {item.name}
                </span>
                {item.status === "failed" && (
                  <span className="text-xs font-medium text-red-600 px-1.5 py-0.5 rounded-xs bg-red-100">
                    Failed
                  </span>
                )}
                {item.status === "pending" && (
                  <span className="text-xs font-medium text-amber-600 px-1.5 py-0.5 rounded-xs bg-amber-100">
                    Pending
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted truncate">
                {item.size && <span>{item.size}</span>}
                {item.size && item.type && <span>&bull;</span>}
                {item.type && <span>{item.type}</span>}
                {(item.size || item.type) && item.uploadedAt && <span>&bull;</span>}
                {item.uploadedAt && <span>{item.uploadedAt}</span>}
                {item.uploadedAt && item.uploadedBy && <span>by {item.uploadedBy}</span>}
              </div>
              {item.metadata && <div className="mt-1">{item.metadata}</div>}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {onView && item.status !== "failed" && (
                <Button
                  variant="ghost"
                  density="compact"
                  onClick={() => onView(item)}
                  aria-label={`View ${item.name}`}
                >
                  View
                </Button>
              )}
              {onDownload && item.status !== "failed" && (
                <Button
                  variant="ghost"
                  density="compact"
                  onClick={() => onDownload(item)}
                  aria-label={`Download ${item.name}`}
                >
                  Download
                </Button>
              )}
              {onRemove && (
                <Button
                  variant="ghost"
                  density="compact"
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  onClick={() => onRemove(item)}
                  aria-label={`Remove ${item.name}`}
                >
                  Remove
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    );
  }
);
AttachmentList.displayName = "AttachmentList";
