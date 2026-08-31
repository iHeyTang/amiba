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
  // Focus is the border alone — no ring halo: the glow read as a smudged
  // shadow on light surfaces, and a hairline color change is enough in
  // this design language.
  "focus-visible:border-ring/50 focus-visible:bg-background focus-visible:outline-none " +
  "aria-[invalid=true]:border-destructive/50 " +
  "disabled:cursor-not-allowed disabled:opacity-50";
