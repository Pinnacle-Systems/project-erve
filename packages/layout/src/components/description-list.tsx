import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";
import { DataLabel, type DataLabelProps } from "./data-label";

const descriptionListVariants = cva("grid grid-cols-1", {
  variants: {
    columns: {
      1: "sm:grid-cols-1",
      2: "sm:grid-cols-2",
      3: "sm:grid-cols-2 lg:grid-cols-3",
      4: "sm:grid-cols-2 lg:grid-cols-4",
    },
    density: {
      compact: "gap-x-4 gap-y-2",
      comfortable: "gap-x-6 gap-y-4",
      touch: "gap-x-8 gap-y-6",
    },
  },
  defaultVariants: {
    columns: 2,
    density: "comfortable",
  },
});

export interface DescriptionListProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof descriptionListVariants> {}

export const DescriptionList = React.forwardRef<HTMLDivElement, DescriptionListProps>(
  ({ className, columns, density, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(descriptionListVariants({ columns, density }), className)}
        {...props}
      />
    );
  }
) as React.ForwardRefExoticComponent<DescriptionListProps & React.RefAttributes<HTMLDivElement>> & {
  Item: typeof DescriptionListItem;
};

const itemSpanVariants = cva("", {
  variants: {
    span: {
      1: "col-span-1",
      2: "sm:col-span-2",
      3: "sm:col-span-2 lg:col-span-3",
      4: "sm:col-span-2 lg:col-span-4",
    },
  },
  defaultVariants: {
    span: 1,
  },
});

export interface DescriptionListItemProps extends DataLabelProps {
  span?: 1 | 2 | 3 | 4;
}

const DescriptionListItem = React.forwardRef<HTMLDivElement, DescriptionListItemProps>(
  ({ className, span, ...props }, ref) => {
    return (
      <DataLabel
        ref={ref}
        className={cn(itemSpanVariants({ span }), className)}
        {...props}
      />
    );
  }
);
DescriptionListItem.displayName = "DescriptionList.Item";

DescriptionList.displayName = "DescriptionList";
DescriptionList.Item = DescriptionListItem;
