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
  // Focus uses a quiet surface change instead of another border or ring.
  "focus-visible:bg-background focus-visible:outline-none " +
  "aria-[invalid=true]:border-destructive/50 " +
  "disabled:cursor-not-allowed disabled:opacity-50";
