import * as SelectPrimitive from "@radix-ui/react-select";
import { cva, type VariantProps } from "class-variance-authority";
import {
  type ComponentPropsWithoutRef,
  type ElementRef,
  forwardRef,
  type ReactNode,
} from "react";
import { useTheme } from "@erve/theme";
import { cn } from "../lib/utils";

const ChevronDown = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const CheckMark = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const triggerVariants = cva(
  [
    "flex w-full items-center justify-between gap-2 rounded-control border bg-surface-raised",
    "text-foreground font-sans",
    "transition-colors duration-150 ease-out",
    "focus:outline-hidden focus:ring-[length:var(--erp-focus-ring-width)] focus:ring-[var(--erp-focus-ring)] focus:ring-offset-[var(--erp-focus-ring-offset)]",
    "disabled:pointer-events-none disabled:opacity-[var(--erp-disabled-opacity)] disabled:bg-[var(--erp-form-field-disabled-bg)] disabled:text-[var(--erp-text-disabled)] disabled:border-[var(--erp-border-disabled)]",
    "data-placeholder:text-muted-foreground",
  ].join(" "),
  {
    variants: {
      state: {
        default:
          "border-[var(--erp-form-field-border)] focus:border-[var(--erp-form-field-focus-border)]",
        error:
          "border-[var(--erp-form-field-error-border)] focus:ring-[var(--erp-focus-ring)] focus:border-[var(--erp-form-field-error-border)]",
      },
      density: {
        compact: "h-8 px-3 text-xs",
        comfortable:
          "h-control px-[var(--erp-control-padding-x)] text-control",
        touch: "h-11 px-4 text-base",
      },
    },
    defaultVariants: {
      state: "default",
    },
  },
);

export type SelectFieldDensity = NonNullable<
  VariantProps<typeof triggerVariants>["density"]
>;
export type SelectFieldWidth = "fill" | "xs" | "sm" | "md" | "lg" | "xl";

const fieldWidthClasses: Record<SelectFieldWidth, string> = {
  fill: "w-[var(--erp-size-intent-fill)]",
  xs: "w-[var(--erp-control-width-xs)] max-w-full",
  sm: "w-[var(--erp-control-width-sm)] max-w-full",
  md: "w-[var(--erp-control-width-md)] max-w-full",
  lg: "w-[var(--erp-control-width-lg)] max-w-full",
  xl: "w-[var(--erp-control-width-xl)] max-w-full",
};

// Low-level Radix parts — consumers can compose these directly
export const SelectRoot = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = forwardRef<
  ElementRef<typeof SelectPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> &
    VariantProps<typeof triggerVariants>
>(({ className, children, state, density, ...props }, ref) => {
  const { densityName } = useTheme();
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(triggerVariants({ state, density: density ?? densityName }), className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <span className="text-muted-foreground shrink-0">
          <ChevronDown />
        </span>
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

export const SelectContent = forwardRef<
  ElementRef<typeof SelectPrimitive.Content>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        "z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md bg-surface shadow-popover border border-border",
        position === "popper" &&
          "w-[--radix-select-trigger-width] max-h-[--radix-select-content-available-height]",
        className,
      )}
      position={position}
      {...props}
    >
      <SelectPrimitive.Viewport className="p-1">
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

export const SelectItem = forwardRef<
  ElementRef<typeof SelectPrimitive.Item>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-xs",
      "py-1.5 pl-8 pr-2 text-sm text-foreground outline-hidden",
      "transition-colors duration-150 ease-out",
      "hover:bg-[var(--erp-surface-hover)] hover:text-foreground",
      "focus:bg-[var(--erp-surface-hover)] focus:text-foreground",
      "data-[highlighted]:bg-[var(--erp-surface-hover)] data-[highlighted]:text-foreground",
      "data-[state=checked]:bg-[var(--erp-surface-selected)] data-[state=checked]:text-foreground",
      "data-[state=checked]:hover:bg-[var(--erp-surface-selected-hover)]",
      "data-[state=checked]:focus:bg-[var(--erp-surface-selected-hover)]",
      "data-[state=checked]:data-[highlighted]:bg-[var(--erp-surface-selected-hover)]",
      "data-disabled:pointer-events-none data-disabled:text-[var(--erp-text-disabled)] data-disabled:opacity-[var(--erp-disabled-opacity)]",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <CheckMark />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

export const SelectLabel = forwardRef<
  ElementRef<typeof SelectPrimitive.Label>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1 text-xs font-semibold text-muted-foreground", className)}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

export const SelectSeparator = forwardRef<
  ElementRef<typeof SelectPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-[var(--erp-color-border-muted)]", className)}
    {...props}
  />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

// Compound convenience wrapper: SelectField = label + trigger + content + error
export interface SelectFieldProps
  extends ComponentPropsWithoutRef<typeof SelectPrimitive.Root> {
  label?: string;
  "aria-label"?: string;
  errorMessage?: string;
  helpText?: string;
  density?: SelectFieldDensity;
  width?: SelectFieldWidth;
  error?: boolean;
  id?: string;
  className?: string;
  placeholder?: string;
  children: ReactNode;
}

export const SelectField = ({
  label,
  "aria-label": ariaLabel,
  errorMessage,
  helpText,
  density,
  width = "md",
  error,
  id,
  className,
  placeholder,
  children,
  ...rootProps
}: SelectFieldProps) => {
  const fieldId =
    id ?? (label ? `select-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);
  const hasError = Boolean(error || errorMessage);

  return (
    <div
      data-width={width}
      className={cn("flex flex-col gap-1.5", fieldWidthClasses[width], className)}
    >
      {label && (
        <label
          htmlFor={fieldId}
          className="text-sm font-medium text-[var(--erp-form-label-color)] select-none leading-none"
        >
          {label}
        </label>
      )}
      <SelectRoot {...rootProps}>
        <SelectTrigger
          id={fieldId}
          state={hasError ? "error" : "default"}
          density={density}
          aria-invalid={hasError || undefined}
          aria-label={!label ? ariaLabel : undefined}
        >
          <SelectValue placeholder={placeholder ?? "Select..."} />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </SelectRoot>
      {errorMessage && (
        <p className="text-xs text-[var(--erp-form-field-error-text-color)] leading-none" role="alert">
          {errorMessage}
        </p>
      )}
      {!errorMessage && helpText && (
        <p className="text-xs text-[var(--erp-form-field-help-text-color)] leading-none">{helpText}</p>
      )}
    </div>
  );
};

SelectField.displayName = "SelectField";
