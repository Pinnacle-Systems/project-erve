import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/utils";
import { ValidationMessage } from "./validation-message";

export interface FieldGroupProps extends HTMLAttributes<HTMLFieldSetElement> {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  required?: boolean;
}

export const FieldGroup = forwardRef<HTMLFieldSetElement, FieldGroupProps>(
  ({ className, label, description, error, required, children, ...props }, ref) => {
    return (
      <fieldset ref={ref} className={cn("flex flex-col gap-3", className)} {...props}>
        {(label || description) && (
          <div className="flex flex-col gap-1.5">
            {label && (
              <legend className="text-sm font-semibold text-foreground">
                {label}
                {required && <span className="ml-1 text-danger" aria-hidden="true">*</span>}
              </legend>
            )}
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </div>
        )}
        <div className="flex flex-col gap-2">
          {children}
        </div>
        {error && (
          <ValidationMessage tone="error">{error}</ValidationMessage>
        )}
      </fieldset>
    );
  },
);
FieldGroup.displayName = "FieldGroup";
