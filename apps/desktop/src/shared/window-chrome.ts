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
