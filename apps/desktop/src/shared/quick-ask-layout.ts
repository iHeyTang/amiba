export const QUICK_ASK_COMPACT_HEIGHT = 108;
// The visible conversation remains ~520px high; the extra stage height is
// transparent paint room so card and modal shadows do not meet the OS window
// boundary and get cropped into a hard edge.
export const QUICK_ASK_PICKER_STAGE_HEIGHT = 576;
export const QUICK_ASK_CONVERSATION_HEIGHT = 576;
export const QUICK_ASK_CARD_SHADOW_GUTTER_Y = 28;
export const QUICK_ASK_COMPACT_CARD_HEIGHT = 92;

// The compact card's bottom edge stays 22px below the transparent stage's
// centre. When a multiline draft makes the Composer taller, only the card's
// top edge moves: the toolbar and send button keep their screen position.
export const QUICK_ASK_CARD_BOTTOM_OFFSET_FROM_CENTER = 22;
export const QUICK_ASK_MAX_DRAFT_CARD_HEIGHT =
  QUICK_ASK_PICKER_STAGE_HEIGHT - QUICK_ASK_CARD_SHADOW_GUTTER_Y * 2;

export interface QuickAskSurfaceLayout {
  anchor: "top" | "center" | "bottom";
  height: number;
}

export interface QuickAskCardLayout {
  height: number;
  top: number;
}

/**
 * Resolve the visible card inside the fixed transparent stage.
 *
 * Empty Quick Ask starts at the established compact height, then grows upward
 * with the Composer's measured height. This keeps every Composer child inside
 * the card without moving the bottom toolbar. A real conversation owns the
 * full shadow-safe panel area instead.
 */
export function resolveQuickAskCardLayout(
  conversationExpanded: boolean,
  composerHeight: number,
): QuickAskCardLayout {
  if (conversationExpanded) {
    return {
      top: QUICK_ASK_CARD_SHADOW_GUTTER_Y,
      height:
        QUICK_ASK_CONVERSATION_HEIGHT -
        QUICK_ASK_CARD_SHADOW_GUTTER_Y * 2,
    };
  }

  const measuredHeight = Number.isFinite(composerHeight)
    ? Math.ceil(composerHeight)
    : QUICK_ASK_COMPACT_CARD_HEIGHT;
  const height = Math.min(
    QUICK_ASK_MAX_DRAFT_CARD_HEIGHT,
    Math.max(QUICK_ASK_COMPACT_CARD_HEIGHT, measuredHeight),
  );
  const bottom =
    QUICK_ASK_PICKER_STAGE_HEIGHT / 2 +
    QUICK_ASK_CARD_BOTTOM_OFFSET_FROM_CENTER;

  // Preserve the toolbar edge while upper shadow room remains. Extremely
  // tall drafts (attachments + context rail + max-height editor) then keep
  // the top gutter and use the stage's lower room instead of overflowing.
  return {
    top: Math.max(QUICK_ASK_CARD_SHADOW_GUTTER_Y, bottom - height),
    height,
  };
}

/**
 * Picker visibility is intentionally absent from this decision. The fixed
 * stage must not resize when model/Profile modals or approval menus toggle.
 */
export function resolveQuickAskSurfaceLayout(
  conversationExpanded: boolean,
): QuickAskSurfaceLayout {
  return conversationExpanded
    ? { anchor: "top", height: QUICK_ASK_CONVERSATION_HEIGHT }
    : { anchor: "center", height: QUICK_ASK_PICKER_STAGE_HEIGHT };
}
