import * as React from "react";

import { cn } from "./cn";
import {
  FORM_CONTROL_STATE_CLASS,
  FORM_CONTROL_SURFACE_CLASS,
} from "./form-control";
const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 px-3 py-1.5",
        FORM_CONTROL_SURFACE_CLASS,
        FORM_CONTROL_STATE_CLASS,
        "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = "Input";

export { Input };
