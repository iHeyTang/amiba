export const APP_SIDEBAR_DEFAULT_WIDTH = 240;
export const APP_SIDEBAR_MIN_WIDTH = 180;
export const APP_SIDEBAR_MAX_WIDTH = 420;
export const APP_SIDEBAR_SNAP_DISTANCE = 12;

export function clampAppSidebarWidth(value: number): number {
  return Math.min(
    APP_SIDEBAR_MAX_WIDTH,
    Math.max(APP_SIDEBAR_MIN_WIDTH, Math.round(value)),
  );
}

export function snapAppSidebarWidth(value: number): number {
  const width = clampAppSidebarWidth(value);
  return Math.abs(width - APP_SIDEBAR_DEFAULT_WIDTH) <=
    APP_SIDEBAR_SNAP_DISTANCE
    ? APP_SIDEBAR_DEFAULT_WIDTH
    : width;
}
