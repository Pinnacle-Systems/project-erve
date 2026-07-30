import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from "react";
import type { Density } from "@erve/theme";
import { cn } from "../lib/utils";
import { DensityOverrideProvider, useResolvedDensity } from "../lib/density";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;

const menuItemDensityClasses = {
  compact: "min-h-8 py-1.5 text-sm",
  comfortable: "min-h-9 py-2 text-sm",
  touch: "min-h-11 py-2.5 text-base",
} as const;

export interface DropdownMenuContentProps
  extends ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> {
  density?: Density;
}

export const DropdownMenuContent = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Content>,
  DropdownMenuContentProps
>(({ className, sideOffset = 4, density, ...props }, ref) => {
  const resolvedDensity = useResolvedDensity(density);
  return (
    <DensityOverrideProvider density={resolvedDensity}>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          ref={ref}
          sideOffset={sideOffset}
          data-density={resolvedDensity}
          className={cn(
            "z-50 min-w-[180px] overflow-hidden rounded-md bg-surface shadow-popover border border-border",
            "p-1 outline-none",
            className,
          )}
          {...props}
        />
      </DropdownMenuPrimitive.Portal>
    </DensityOverrideProvider>
  );
});
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

export interface DropdownMenuItemProps
  extends ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> {
  destructive?: boolean;
}

export const DropdownMenuItem = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Item>,
  DropdownMenuItemProps
>(({ className, destructive = false, ...props }, ref) => {
  const resolvedDensity = useResolvedDensity();
  return <DropdownMenuPrimitive.Item
    ref={ref}
    data-density={resolvedDensity}
    className={cn(
      "relative flex cursor-pointer select-none items-center rounded-xs px-2",
      menuItemDensityClasses[resolvedDensity],
      "text-foreground outline-hidden transition-colors",
      "hover:bg-[var(--erp-surface-hover)] hover:text-foreground",
      "focus:bg-[var(--erp-surface-hover)] focus:text-foreground",
      "data-[highlighted]:bg-[var(--erp-surface-hover)] data-[highlighted]:text-foreground",
      "data-[state=checked]:bg-[var(--erp-surface-selected)] data-[state=checked]:text-foreground",
      "data-[state=checked]:hover:bg-[var(--erp-surface-selected-hover)]",
      "data-[state=checked]:focus:bg-[var(--erp-surface-selected-hover)]",
      "data-[state=checked]:data-[highlighted]:bg-[var(--erp-surface-selected-hover)]",
      "data-disabled:pointer-events-none data-disabled:text-[var(--erp-text-disabled)] data-disabled:opacity-[var(--erp-disabled-opacity)]",
      destructive &&
        "text-[var(--erp-text-danger)] hover:bg-[var(--erp-validation-error-bg)] hover:text-[var(--erp-validation-error-text)] focus:bg-[var(--erp-validation-error-bg)] focus:text-[var(--erp-validation-error-text)] data-[highlighted]:bg-[var(--erp-validation-error-bg)] data-[highlighted]:text-[var(--erp-validation-error-text)]",
      className,
    )}
    {...props}
  />;
});
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

export const DropdownMenuRadioItem = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => {
  const resolvedDensity = useResolvedDensity();
  return <DropdownMenuPrimitive.RadioItem
    ref={ref}
    data-density={resolvedDensity}
    className={cn(
      "relative flex cursor-pointer select-none items-center gap-2 rounded-xs pl-2 pr-2",
      menuItemDensityClasses[resolvedDensity],
      "text-foreground outline-hidden transition-colors",
      "hover:bg-[var(--erp-surface-hover)] hover:text-foreground",
      "focus:bg-[var(--erp-surface-hover)] focus:text-foreground",
      "data-[highlighted]:bg-[var(--erp-surface-hover)] data-[highlighted]:text-foreground",
      "data-disabled:pointer-events-none data-disabled:text-[var(--erp-text-disabled)] data-disabled:opacity-[var(--erp-disabled-opacity)]",
      className,
    )}
    {...props}
  >
    <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--erp-color-primary)]">
      <DropdownMenuPrimitive.ItemIndicator>
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
});
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;

export const DropdownMenuCheckboxItem = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, ...props }, ref) => {
  const resolvedDensity = useResolvedDensity();
  return (
    <DropdownMenuPrimitive.CheckboxItem
      ref={ref}
      data-density={resolvedDensity}
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2 rounded-xs px-2 text-foreground outline-hidden transition-colors",
        menuItemDensityClasses[resolvedDensity],
        "hover:bg-[var(--erp-surface-hover)] focus:bg-[var(--erp-surface-hover)] data-[highlighted]:bg-[var(--erp-surface-hover)]",
        "data-disabled:pointer-events-none data-disabled:text-[var(--erp-text-disabled)] data-disabled:opacity-[var(--erp-disabled-opacity)]",
        className,
      )}
      {...props}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--erp-color-primary)]">
        <DropdownMenuPrimitive.ItemIndicator>
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
});
DropdownMenuCheckboxItem.displayName = DropdownMenuPrimitive.CheckboxItem.displayName;

export const DropdownMenuSubTrigger = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger>
>(({ className, children, ...props }, ref) => {
  const resolvedDensity = useResolvedDensity();
  return (
    <DropdownMenuPrimitive.SubTrigger
      ref={ref}
      data-density={resolvedDensity}
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-xs px-2 text-foreground outline-hidden transition-colors",
        menuItemDensityClasses[resolvedDensity],
        "hover:bg-[var(--erp-surface-hover)] focus:bg-[var(--erp-surface-hover)] data-[highlighted]:bg-[var(--erp-surface-hover)] data-[state=open]:bg-[var(--erp-surface-hover)]",
        "data-disabled:pointer-events-none data-disabled:text-[var(--erp-text-disabled)] data-disabled:opacity-[var(--erp-disabled-opacity)]",
        className,
      )}
      {...props}
    >
      {children}
      <span className="ml-auto pl-2 text-muted-foreground" aria-hidden="true">›</span>
    </DropdownMenuPrimitive.SubTrigger>
  );
});
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName;

export const DropdownMenuLabel = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Label>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(
      "px-2 py-1 text-xs font-semibold text-muted-foreground select-none",
      className,
    )}
    {...props}
  />
));
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

export const DropdownMenuSeparator = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-[var(--erp-border-default)]", className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;
