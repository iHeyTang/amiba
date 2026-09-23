import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "./cn";

/** Shared keyboard- and touch-accessible slider using the same UI tokens as other controls. */
export const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, "aria-label": label, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn("relative flex h-6 w-full touch-none select-none items-center data-[disabled]:opacity-50", className)}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-primary/15">
      <SliderPrimitive.Range className="absolute h-full bg-primary" />
    </SliderPrimitive.Track>
    {(props.value ?? props.defaultValue ?? [0]).map((_, index) => (
      <SliderPrimitive.Thumb key={index} aria-label={label}
        className="block h-4 w-4 rounded-full border border-primary/50 bg-background shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none" />
    ))}
  </SliderPrimitive.Root>
));
Slider.displayName = "Slider";
