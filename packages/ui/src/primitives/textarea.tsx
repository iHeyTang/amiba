import * as React from "react";

import { cn } from "./cn";
import {
  FORM_CONTROL_STATE_CLASS,
  FORM_CONTROL_SURFACE_CLASS,
} from "./form-control";
const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      data-glass-control="field"
      className={cn(
        "flex min-h-[60px] px-3 py-2",
        FORM_CONTROL_SURFACE_CLASS,
        FORM_CONTROL_STATE_CLASS,
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
