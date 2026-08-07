import { describe, expect, it } from "vitest"

import {
  measureComposerDockTargetHeight,
  resolveChatSurfaceMode,
  shouldMountComposerDock,
} from "../ChatSurface"

describe("resolveChatSurfaceMode", () => {
  it("uses the id-less state as home", () => {
    expect(resolveChatSurfaceMode("")).toBe("home")
  })

  it("keeps an existing empty conversation in conversation mode", () => {
    expect(resolveChatSurfaceMode("conversation-with-zero-messages")).toBe(
      "conversation",
    )
  })
})

describe("shouldMountComposerDock", () => {
  it("keeps one dock mounted across Quick Ask's first-session boundary", () => {
    expect(shouldMountComposerDock(false, true, true)).toBe(true)
    expect(shouldMountComposerDock(true, false, true)).toBe(true)
  })

  it("preserves the existing empty-state branch for other surfaces", () => {
    expect(shouldMountComposerDock(false, true, false)).toBe(false)
  })
})

describe("measureComposerDockTargetHeight", () => {
  it("uses the editor destination instead of an intermediate animation frame", () => {
    const dock = document.createElement("footer")
    const editor = document.createElement("div")
    editor.dataset.autoGrowEditor = ""
    editor.dataset.autoGrowTargetHeight = "80"
    dock.append(editor)

    dock.getBoundingClientRect = () => ({ height: 120 }) as DOMRect
    editor.getBoundingClientRect = () => ({ height: 50 }) as DOMRect

    expect(measureComposerDockTargetHeight(dock)).toBe(150)
  })
})
