/**
 * Shared visual contract for non-composer form controls.
 *
 * Sizing stays with each primitive; surface, focus, error, and disabled
 * behavior live here so Input, Textarea, and Select cannot drift apart.
 */
export const FORM_CONTROL_SURFACE_CLASS =
  "w-full rounded-lg border border-border/70 bg-muted/[0.14] text-sm shadow-none " +
  "transition-[border-color,background-color,box-shadow] duration-150 " +
  "placeholder:text-muted-foreground/65 hover:border-border";

export const FORM_CONTROL_STATE_CLASS =
  "focus-visible:border-ring/40 focus-visible:bg-background focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-ring/10 " +
  "aria-[invalid=true]:border-destructive/50 aria-[invalid=true]:ring-destructive/10 " +
  "disabled:cursor-not-allowed disabled:opacity-50";
