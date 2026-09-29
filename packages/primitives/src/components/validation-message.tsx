import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../lib/utils";

const validationMessageVariants = cva("text-sm", {
  variants: {
    tone: {
      default: "text-muted-foreground",
      error: "text-danger",
      warning: "text-warning",
      success: "text-success",
      info: "text-info",
    },
  },
  defaultVariants: {
    tone: "default",
  },
});

export interface ValidationMessageProps
  extends HTMLAttributes<HTMLParagraphElement>,
    VariantProps<typeof validationMessageVariants> {}

export const ValidationMessage = forwardRef<HTMLParagraphElement, ValidationMessageProps>(
  ({ className, tone = "default", role, ...props }, ref) => {
    const resolvedRole = role ?? (tone === "error" ? "alert" : undefined);
    return (
      <p
        ref={ref}
        role={resolvedRole}
        className={cn(validationMessageVariants({ tone }), className)}
        {...props}
      />
    );
  },
);
ValidationMessage.displayName = "ValidationMessage";
