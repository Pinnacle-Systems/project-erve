import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cva } from "class-variance-authority";
import {
  createContext,
  type ComponentPropsWithoutRef,
  type ElementRef,
  forwardRef,
  useContext,
} from "react";
import type { Density } from "@erve/theme";
import { cn } from "../lib/utils";
import { DensityOverrideProvider, useResolvedDensity } from "../lib/density";

// Radix's own TabsContent only sets the native `hidden` attribute when NOT
// force-mounted (`hidden: !(forceMount || isSelected)`) — with forceMount
// (required here so tab-local form state survives switching away and back),
// every panel keeps `tabIndex={0}` and no `hidden`/`aria-hidden`, so an
// inactive-but-mounted panel would otherwise stay fully reachable by
// keyboard and screen readers. This context carries the controlled active
// value down to TabsContent so it can correct that itself.
const ActiveTabValueContext = createContext<string | undefined>(undefined);

export interface TabsProps extends ComponentPropsWithoutRef<typeof TabsPrimitive.Root> {
  /** Controlled only, by this primitive's contract — required so TabsContent can know the active value without re-deriving Radix's internal state. */
  value: string;
}

export const Tabs = forwardRef<ElementRef<typeof TabsPrimitive.Root>, TabsProps>(
  ({ value, children, ...props }, ref) => (
    <ActiveTabValueContext.Provider value={value}>
      <TabsPrimitive.Root ref={ref} value={value} {...props}>
        {children}
      </TabsPrimitive.Root>
    </ActiveTabValueContext.Provider>
  ),
);
Tabs.displayName = TabsPrimitive.Root.displayName;

export interface TabsListProps extends ComponentPropsWithoutRef<typeof TabsPrimitive.List> {
  density?: Density;
}

// Horizontally scrollable rather than wrapping, so a fixed set of tab labels
// (e.g. Overview/Production/Quality/History) stays a single row and usable
// down to narrow/mobile widths instead of collapsing into an awkward
// two-line strip.
export const TabsList = forwardRef<ElementRef<typeof TabsPrimitive.List>, TabsListProps>(
  ({ className, density, children, ...props }, ref) => {
    const resolvedDensity = useResolvedDensity(density);
    return (
      <DensityOverrideProvider density={resolvedDensity}>
        <TabsPrimitive.List
          ref={ref}
          data-density={resolvedDensity}
          className={cn(
            "flex items-center gap-1 overflow-x-auto border-b border-border-subtle",
            "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            className,
          )}
          {...props}
        >
          {children}
        </TabsPrimitive.List>
      </DensityOverrideProvider>
    );
  },
);
TabsList.displayName = TabsPrimitive.List.displayName;

const tabsTriggerVariants = cva(
  [
    "relative inline-flex shrink-0 items-center whitespace-nowrap font-medium text-muted-foreground",
    "-mb-px border-b-2 border-transparent transition-colors duration-150 ease-out",
    "hover:text-foreground disabled:pointer-events-none disabled:opacity-[var(--erp-disabled-opacity)]",
    "focus-visible:outline-hidden focus-visible:ring-[length:var(--erp-focus-ring-width)] focus-visible:ring-[var(--erp-focus-ring)] focus-visible:ring-offset-[var(--erp-focus-ring-offset)]",
    "data-[state=active]:border-[var(--erp-color-primary)] data-[state=active]:text-foreground",
  ].join(" "),
  {
    variants: {
      density: {
        compact: "h-8 px-2.5 text-xs",
        comfortable: "h-10 px-3.5 text-sm",
        touch: "h-11 px-5 text-base",
      },
    },
  },
);

export interface TabsTriggerProps extends ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> {
  density?: Density;
}

export const TabsTrigger = forwardRef<ElementRef<typeof TabsPrimitive.Trigger>, TabsTriggerProps>(
  ({ className, density, ...props }, ref) => {
    const resolvedDensity = useResolvedDensity(density);
    return (
      <TabsPrimitive.Trigger
        ref={ref}
        className={cn(tabsTriggerVariants({ density: resolvedDensity }), className)}
        {...props}
      />
    );
  },
);
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

// forceMount is explicit and required here: pages with stateful forms inside
// a tab (drafts, checkboxes, batch allocations) must not lose that state
// when the user switches away and back, which Radix's default unmount-on-
// deselect would do. Because Radix doesn't apply `hidden` for force-mounted
// content, this component computes "is this panel the active one" itself
// (via ActiveTabValueContext, from the value prop each TabsContent already
// takes) and explicitly sets `inert` + `tabIndex={-1}` on inactive panels —
// `inert` removes the whole subtree from both the accessibility tree and
// the keyboard tab order while leaving it mounted and visually hideable via
// the data-state utility below.
export const TabsContent = forwardRef<
  ElementRef<typeof TabsPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, value, ...props }, ref) => {
  const activeValue = useContext(ActiveTabValueContext);
  const isActive = activeValue === value;
  return (
    <TabsPrimitive.Content
      ref={ref}
      value={value}
      forceMount
      inert={isActive ? undefined : true}
      tabIndex={isActive ? 0 : -1}
      className={cn("focus-visible:outline-hidden data-[state=inactive]:hidden", className)}
      {...props}
    />
  );
});
TabsContent.displayName = TabsPrimitive.Content.displayName;
