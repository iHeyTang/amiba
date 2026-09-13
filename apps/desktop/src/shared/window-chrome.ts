export const WINDOW_TITLE_BAR_HEIGHT = 40;
export const MAC_TRAFFIC_LIGHT_SIZE = 14;
// AppKit paints the visible 12px dots one pixel below the supplied 14px
// control frame. Lift the frame by 1px so the painted dots align optically
// with the SVG and text content centred in the 40px web title bar.
export const MAC_TRAFFIC_LIGHT_OPTICAL_OFFSET = -1;
export const MAC_TRAFFIC_LIGHT_TOP =
  (WINDOW_TITLE_BAR_HEIGHT - MAC_TRAFFIC_LIGHT_SIZE) / 2 +
  MAC_TRAFFIC_LIGHT_OPTICAL_OFFSET;
export const MAC_TRAFFIC_LIGHT_RESERVE = 96;

/** Composite computed CSS rgb(a) colors, including nested/animated backdrops. */
export function compositeCaptionColor(base: string, overlay: string, opacity: number) {
  const parse = (value: string) => value.match(/[\d.]+/g)?.map(Number);
  const bg = parse(base);
  const fg = parse(overlay);
  if (!bg || !fg || bg.length < 3 || fg.length < 3) return base;
  const alpha = Math.max(0, Math.min(1, (fg[3] ?? 1) * opacity));
  const channels = bg.slice(0, 3).map((channel, i) =>
    Math.round(channel * (1 - alpha) + fg[i] * alpha));
  return `rgb(${channels.join(", ")})`;
}

// Windows keeps its native caption buttons in a dedicated strip above panes.
export function getWindowChrome(platform: string) {
  return {
    topBarHeightPx: WINDOW_TITLE_BAR_HEIGHT,
    leftInsetPx: platform === "darwin" ? MAC_TRAFFIC_LIGHT_RESERVE : 0,
    rightInsetPx: platform === "win32" ? 138 : 0,
    standaloneTitleBar: platform === "win32",
  };
}
