import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "./cn";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;
const PopoverClose = PopoverPrimitive.Close;

export type PopoverContentSize =
  | "narrow"
  | "compact"
  | "menu"
  | "sm"
  | "md"
  | "lg"
  | "auto";
export type PopoverContentPadding = "none" | "sm" | "md";

const POPOVER_SIZE_CLASS: Record<PopoverContentSize, string> = {
  narrow: "w-40",
  compact: "w-44",
  menu: "w-52",
  sm: "w-64",
  md: "w-80",
  lg: "w-[22rem]",
  auto: "w-auto",
};

const POPOVER_PADDING_CLASS: Record<PopoverContentPadding, string> = {
  none: "p-0",
  sm: "p-2",
  md: "p-3",
};

interface PopoverContentProps
  extends React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> {
  /** Semantic width presets keep product popovers on one shared scale. */
  size?: PopoverContentSize;
  /** Content density only; radius, edge, depth and motion remain invariant. */
  padding?: PopoverContentPadding;
}

/**
 * Standard interactive anchored surface.
 *
 * Use for rich, dismissible content attached to a trigger. It owns Portal,
 * collision handling, focus restoration, outside-click/Escape dismissal and
 * the product-wide frame/motion treatment. Business callers should choose a
 * size/padding preset and style their inner content, not replace the shell.
 */
const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  PopoverContentProps
>(
  (
    {
      align = "center",
      className,
      collisionPadding = 12,
      padding = "sm",
      sideOffset = 8,
      size = "md",
      ...props
    },
    ref,
  ) => (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        collisionPadding={collisionPadding}
        sideOffset={sideOffset}
        data-ui-overlay="popover"
        className={cn(
          "z-[var(--z-popover)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-xl border border-border/60 bg-popover text-popover-foreground shadow-popover outline-none",
          "origin-[var(--radix-popover-content-transform-origin)] duration-150 ease-out",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          "data-[state=closed]:animate-out data-[state=closed]:fill-mode-forwards data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          "data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1",
          "motion-reduce:animate-none",
          POPOVER_SIZE_CLASS[size],
          POPOVER_PADDING_CLASS[padding],
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  ),
);
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

function PopoverHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-1", className)} {...props} />;
}
PopoverHeader.displayName = "PopoverHeader";

function PopoverTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "text-xs font-medium leading-none text-foreground",
        className,
      )}
      {...props}
    />
  );
}
PopoverTitle.displayName = "PopoverTitle";

function PopoverDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-[11px] leading-4 text-muted-foreground", className)}
      {...props}
    />
  );
}
PopoverDescription.displayName = "PopoverDescription";

export {
  Popover,
  PopoverAnchor,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
};
