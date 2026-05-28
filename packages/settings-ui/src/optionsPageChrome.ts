/**
 * Settings shell — sidebar branding row + main content section headers
 * share this height so logo strip / pane title strip align across the
 * two columns. h-14 = 32px logo + vertical padding.
 *
 * Border-less by design: visual separation between the sidebar column
 * and the main pane comes from a subtle background-color shift, not
 * a hard 1px divider. Section headers below this row sit naturally on
 * the background; the rhythm is the larger heading weight, not a rule.
 */
export const OPTIONS_SHELL_HEADER_ROW =
  "flex h-14 shrink-0 items-center" as const
