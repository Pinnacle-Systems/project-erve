import { forwardRef, type ReactNode } from "react";
import { cn } from "../lib/utils";

export interface ErrorStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export const ErrorState = forwardRef<HTMLDivElement, ErrorStateProps>(
  ({ className, title, description, action, ...props }, ref) => {
    return (
      <div
        ref={ref}
        role="alert"
        className={cn("flex flex-col items-center justify-center p-8 gap-4 text-center rounded-[var(--erp-radius-lg)] border border-[var(--erp-color-danger)] bg-[var(--erp-danger-soft)]", className)}
        {...props}
      >
        <div className="flex flex-col gap-1.5 items-center">
          <h3 className="text-lg font-semibold text-danger">{title}</h3>
          {description && (
            <p className="text-sm text-danger opacity-90">
              {description}
            </p>
          )}
        </div>
        {action && <div className="mt-2">{action}</div>}
      </div>
    );
  }
);
ErrorState.displayName = "ErrorState";
