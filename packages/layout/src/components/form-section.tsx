import * as React from "react";
import { cn } from "../lib/utils";

export interface FormSectionProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

export const FormSection = React.forwardRef<HTMLDivElement, FormSectionProps>(
  ({ className, title, description, actions, children, ...props }, ref) => {
    return (
      <section
        ref={ref}
        className={cn("flex flex-col gap-[var(--erp-form-section-gap)]", className)}
        {...props}
      >
        {(title || description || actions) && (
          <div className="flex items-center justify-between gap-4 border-b border-border-subtle pb-3">
            <div className="flex flex-col gap-1">
              {title && (
                <h4 className="text-sm font-medium text-foreground">{title}</h4>
              )}
              {description && (
                <p className="text-xs text-muted-foreground">{description}</p>
              )}
            </div>
            {actions && <div className="shrink-0">{actions}</div>}
          </div>
        )}
        <div className="flex flex-col gap-[var(--erp-form-section-gap)]">{children}</div>
      </section>
    );
  }
);
FormSection.displayName = "FormSection";
