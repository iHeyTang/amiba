export const MIN_WORKSPACE_WIDTH = 360;
export const MIN_CONVERSATION_WIDTH = 320;

/** Keep preferences independent of the current window; fit only when drawing. */
export function preferredWorkspaceWidth(value: number): number {
  return Math.max(MIN_WORKSPACE_WIDTH, Math.round(value));
}
export function workspaceWidthBounds(available: number) {
  const width = Math.max(0, available);
  // Below the combined minimums, share the remaining space instead of overflow.
  const max = Math.max(width / 2, width - MIN_CONVERSATION_WIDTH);
  return { min: Math.min(MIN_WORKSPACE_WIDTH, max), max };
}
export function fitWorkspaceWidth(value: number, available: number): number {
  const { min, max } = workspaceWidthBounds(available);
  return Math.min(max, Math.max(min, Math.round(value)));
}
