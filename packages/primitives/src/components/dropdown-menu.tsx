import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from "react";
import { cn } from "../lib/utils";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export const DropdownMenuSubTrigger = DropdownMenuPrimitive.SubTrigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;

export const DropdownMenuContent = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-[180px] overflow-hidden rounded-md bg-surface shadow-popover border border-border",
        "p-1 outline-none",
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

export interface DropdownMenuItemProps
  extends ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> {
  destructive?: boolean;
}

export const DropdownMenuItem = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Item>,
  DropdownMenuItemProps
>(({ className, destructive = false, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm",
      "text-foreground outline-none transition-colors",
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
  />
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

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
