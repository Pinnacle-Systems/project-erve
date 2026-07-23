import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { useTheme } from "@erve/theme";
import { cn } from "../lib/utils";

const panelVariants = cva("flex flex-col bg-surface", {
  variants: {
    variant: {
      default: "rounded-panel border border-border shadow-panel",
      subtle: "rounded-panel border border-border-subtle bg-surface-muted shadow-none",
      bordered: "rounded-panel border border-border shadow-none",
    },
    padding: {
      none: "",
      sm: "",
      md: "",
      lg: "",
    },
    density: {
      compact: "",
      comfortable: "",
      touch: "",
    },
  },
  defaultVariants: {
    variant: "default",
    padding: "md",
  },
});

const headerVariants = cva("flex flex-col gap-1 border-b border-border-subtle", {
  variants: {
    padding: {
      none: "p-0",
      sm: "px-3 py-2",
      md: "px-5 py-4",
      lg: "px-8 py-6",
    },
    density: {
      compact: "",
      comfortable: "",
      touch: "",
    },
  },
  compoundVariants: [
    { density: "compact", padding: "sm", className: "px-2 py-1.5" },
    { density: "compact", padding: "md", className: "px-4 py-3" },
    { density: "compact", padding: "lg", className: "px-6 py-4" },
    { density: "touch", padding: "sm", className: "px-4 py-3" },
    { density: "touch", padding: "md", className: "px-6 py-5" },
    { density: "touch", padding: "lg", className: "px-10 py-8" },
  ],
  defaultVariants: {
    padding: "md",
  },
});

const bodyVariants = cva("flex-1", {
  variants: {
    padding: {
      none: "p-0",
      sm: "p-3",
      md: "p-5",
      lg: "p-8",
    },
    density: {
      compact: "",
      comfortable: "",
      touch: "",
    },
  },
  compoundVariants: [
    { density: "compact", padding: "sm", className: "p-2" },
    { density: "compact", padding: "md", className: "p-4" },
    { density: "compact", padding: "lg", className: "p-6" },
    { density: "touch", padding: "sm", className: "p-4" },
    { density: "touch", padding: "md", className: "p-6" },
    { density: "touch", padding: "lg", className: "p-10" },
  ],
  defaultVariants: {
    padding: "md",
  },
});

const footerVariants = cva("border-t border-border-subtle bg-surface-muted rounded-b-panel", {
  variants: {
    padding: {
      none: "p-0",
      sm: "px-3 py-2",
      md: "px-5 py-3",
      lg: "px-8 py-4",
    },
    density: {
      compact: "",
      comfortable: "",
      touch: "",
    },
  },
  compoundVariants: [
    { density: "compact", padding: "sm", className: "px-2 py-1.5" },
    { density: "compact", padding: "md", className: "px-4 py-2.5" },
    { density: "compact", padding: "lg", className: "px-6 py-3" },
    { density: "touch", padding: "sm", className: "px-4 py-3" },
    { density: "touch", padding: "md", className: "px-6 py-4" },
    { density: "touch", padding: "lg", className: "px-10 py-5" },
  ],
  defaultVariants: {
    padding: "md",
  },
});

export interface PanelProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title">,
    VariantProps<typeof panelVariants> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  padding?: "none" | "sm" | "md" | "lg";
}

export const Panel = React.forwardRef<HTMLDivElement, PanelProps>(
  (
    {
      className,
      variant,
      padding,
      density,
      title,
      description,
      actions,
      footer,
      children,
      ...props
    },
    ref
  ) => {
    const { densityName } = useTheme();
    const resolvedDensity = density ?? densityName;
    return (
      <div
        ref={ref}
        className={cn(panelVariants({ variant, density: resolvedDensity }), className)}
        {...props}
      >
        {(title || description || actions) && (
          <div className={cn(headerVariants({ padding, density: resolvedDensity }))}>
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                {title && (
                  <h3 className="text-sm font-semibold text-foreground">
                    {title}
                  </h3>
                )}
                {description && (
                  <p className="text-xs text-muted-foreground">{description}</p>
                )}
              </div>
              {actions && <div className="shrink-0">{actions}</div>}
            </div>
          </div>
        )}
        <div className={cn(bodyVariants({ padding, density: resolvedDensity }))}>{children}</div>
        {footer && (
          <div className={cn(footerVariants({ padding, density: resolvedDensity }))}>{footer}</div>
        )}
      </div>
    );
  }
);
Panel.displayName = "Panel";
