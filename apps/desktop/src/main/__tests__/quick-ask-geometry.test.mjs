import assert from "node:assert/strict"
import test from "node:test"

import {
  resolveQuickAskResizeBounds,
  resolveQuickAskSummonBounds,
} from "../quick-ask-geometry.ts"
import {
  QUICK_ASK_CARD_BOTTOM_OFFSET_FROM_CENTER,
  QUICK_ASK_CARD_SHADOW_GUTTER_Y,
  QUICK_ASK_COMPACT_CARD_HEIGHT,
  QUICK_ASK_CONVERSATION_HEIGHT,
  QUICK_ASK_MAX_DRAFT_CARD_HEIGHT,
  QUICK_ASK_PICKER_STAGE_HEIGHT,
  resolveQuickAskCardLayout,
  resolveQuickAskSurfaceLayout,
} from "../../shared/quick-ask-layout.ts"

const compact = { x: 100, y: 220, width: 672, height: 108 }

test("the fixed picker stage preserves the compact card's center", () => {
  const expanded = resolveQuickAskResizeBounds(
    compact,
    QUICK_ASK_PICKER_STAGE_HEIGHT,
    "center",
  )

  assert.equal(
    expanded.y,
    compact.y -
      Math.round((QUICK_ASK_PICKER_STAGE_HEIGHT - compact.height) / 2),
  )
  assert.equal(
    expanded.y + expanded.height / 2,
    compact.y + compact.height / 2,
  )
})

test("center-anchored collapse preserves the same screen coordinate", () => {
  const expanded = resolveQuickAskResizeBounds(
    compact,
    QUICK_ASK_PICKER_STAGE_HEIGHT,
    "center",
  )
  const collapsed = resolveQuickAskResizeBounds(
    expanded,
    compact.height,
    "center",
  )

  assert.deepEqual(collapsed, compact)
})

test("conversation expansion keeps the top screen edge fixed", () => {
  const expanded = resolveQuickAskResizeBounds(
    compact,
    QUICK_ASK_CONVERSATION_HEIGHT,
    "top",
  )

  assert.equal(expanded.y, compact.y)
  assert.equal(expanded.height, QUICK_ASK_CONVERSATION_HEIGHT)
})

test("re-summoning an open picker preserves the compact composer center", () => {
  const summoned = resolveQuickAskSummonBounds(
    compact,
    QUICK_ASK_PICKER_STAGE_HEIGHT,
    "center",
  )

  assert.equal(
    summoned.y + summoned.height / 2,
    compact.y + compact.height / 2,
  )
})

test("re-summoning a conversation preserves the top edge", () => {
  const summoned = resolveQuickAskSummonBounds(
    compact,
    QUICK_ASK_CONVERSATION_HEIGHT,
    "top",
  )

  assert.equal(summoned.y, compact.y)
  assert.equal(summoned.height, QUICK_ASK_CONVERSATION_HEIGHT)
})

test("picker visibility cannot change the empty Quick Ask window layout", () => {
  const beforeOpeningPicker = resolveQuickAskSurfaceLayout(false)
  const afterOpeningPicker = resolveQuickAskSurfaceLayout(false)

  assert.deepEqual(afterOpeningPicker, beforeOpeningPicker)
  assert.deepEqual(afterOpeningPicker, {
    anchor: "center",
    height: QUICK_ASK_PICKER_STAGE_HEIGHT,
  })
})

test("the empty card keeps its established compact geometry", () => {
  const layout = resolveQuickAskCardLayout(false, 0)
  const expectedBottom =
    QUICK_ASK_PICKER_STAGE_HEIGHT / 2 +
    QUICK_ASK_CARD_BOTTOM_OFFSET_FROM_CENTER

  assert.equal(layout.height, QUICK_ASK_COMPACT_CARD_HEIGHT)
  assert.equal(layout.top + layout.height, expectedBottom)
})

test("a multiline draft grows the card upward without moving its toolbar edge", () => {
  const compactLayout = resolveQuickAskCardLayout(false, 0)
  const draftLayout = resolveQuickAskCardLayout(false, 180)

  assert.equal(draftLayout.height, 180)
  assert.equal(
    draftLayout.top + draftLayout.height,
    compactLayout.top + compactLayout.height,
  )
  assert.ok(draftLayout.top < compactLayout.top)
})

test("draft growth stays inside the stage shadow gutter", () => {
  const layout = resolveQuickAskCardLayout(false, Number.MAX_SAFE_INTEGER)

  assert.equal(layout.height, QUICK_ASK_MAX_DRAFT_CARD_HEIGHT)
  assert.equal(layout.top, QUICK_ASK_CARD_SHADOW_GUTTER_Y)
})

test("a conversation owns the full shadow-safe card area", () => {
  const layout = resolveQuickAskCardLayout(true, 100)

  assert.deepEqual(layout, {
    top: QUICK_ASK_CARD_SHADOW_GUTTER_Y,
    height:
      QUICK_ASK_CONVERSATION_HEIGHT - QUICK_ASK_CARD_SHADOW_GUTTER_Y * 2,
  })
})
