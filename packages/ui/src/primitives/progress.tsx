import * as React from "react";

import { cn } from "./cn";

export interface ProgressProps
  extends React.ComponentPropsWithoutRef<"div"> {
  /** 0–100. Omit for an indeterminate, animated bar. */
  value?: number;
  /** Accessible name for the progressbar role. */
  label?: string;
}

/**
 * Brand progress bar. The track and indicator use the `--primary` token so
 * the bar follows the active accent (violet / coral / cyan / …) in both
 * themes — never the UA default, which renders a square, OS-green `<progress>`.
 *
 * The indicator is a rounded full-bleed bar with a soft primary glow and a
 * smooth width transition; the track is a translucent primary tint so it
 * reads correctly on light popovers and dark surfaces alike.
 */
const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, label = "Progress", ...props }, ref) => {
    const determinate =
      typeof value === "number" && Number.isFinite(value);
    const percent = determinate
      ? Math.min(100, Math.max(0, Math.round(value)))
      : undefined;
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className={cn(
          "relative h-2 w-full overflow-hidden rounded-full bg-primary/10",
          className,
        )}
        {...props}
      >
        {determinate ? (
          <div
            className="h-full rounded-full bg-primary shadow-[0_0_12px_hsl(var(--primary)/0.45)] transition-[width] duration-500 ease-out motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        ) : (
          <div className="h-full w-1/3 rounded-full bg-primary/70 animate-[progress-indeterminate_1.6s_ease-in-out_infinite]" />
        )}
      </div>
    );
  },
);
Progress.displayName = "Progress";

export { Progress };