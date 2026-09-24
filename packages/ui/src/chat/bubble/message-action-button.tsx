import type { ReactNode } from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "../../primitives";

export function MessageActionButton({
  label,
  icon,
  onClick,
  pressed,
  disabled,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          aria-pressed={pressed}
          disabled={disabled}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors aria-pressed:text-foreground disabled:pointer-events-none disabled:opacity-50 hover:bg-accent/70 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [&_svg]:h-3.5 [&_svg]:w-3.5"
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-[11px]">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
