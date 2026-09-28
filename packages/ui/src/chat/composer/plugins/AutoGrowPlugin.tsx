import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { useLayoutEffect } from "react"

interface AutoGrowPluginProps {
  maxHeightPx: number
  /** Re-measure when density/padding classes change without an editor update. */
  layoutKey?: string
}

export function measureIntrinsicHeight(el: HTMLElement): number {
  // Lexical's root contains normal-flow, zero-margin paragraphs. Their last
  // bottom edge gives the intrinsic height even while the root is capped,
  // scrolled, or animating. Inserting a hidden clone into the live composer
  // invalidates style/layout across the conversation on every keystroke.
  const style = getComputedStyle(el)
  const px = (value: string) => Number.parseFloat(value) || 0
  const borderTop = px(style.borderTopWidth)
  const borders = borderTop + px(style.borderBottomWidth)
  const padding = px(style.paddingTop) + px(style.paddingBottom)
  const minHeight = style.boxSizing === "border-box"
    ? px(style.minHeight) - borders
    : px(style.minHeight) + padding
  const last = el.lastElementChild
  const contentHeight = last
    ? last.getBoundingClientRect().bottom - el.getBoundingClientRect().top
      + el.scrollTop - borderTop + px(style.paddingBottom)
    : padding
  return Math.ceil(Math.max(minHeight, contentHeight))
}

/** Mirror the old textarea auto-grow: grow to content, cap at maxHeightPx, then scroll. */
export function AutoGrowPlugin({ maxHeightPx, layoutKey }: AutoGrowPluginProps) {
  const [editor] = useLexicalComposerContext()
  useLayoutEffect(() => {
    const apply = () => {
      const el = editor.getRootElement()
      if (!el) return
      const sh = measureIntrinsicHeight(el)
      const targetHeight = Math.min(sh, maxHeightPx)
      // Floating shells may animate the editor height. Keep the final target
      // on the element so the shell can size its card to the destination
      // rather than chasing the editor's intermediate animation frames.
      const targetHeightData = String(targetHeight)
      if (el.dataset.autoGrowTargetHeight !== targetHeightData) {
        el.dataset.autoGrowTargetHeight = targetHeightData
      }

      const targetCssHeight = `${targetHeight}px`
      if (el.style.height === targetCssHeight) {
        el.style.overflowY = sh > maxHeightPx ? "auto" : "hidden"
        return
      }

      // Continue from the currently painted frame when typing adds another
      // wrapped line mid-transition. The temporary transition override keeps
      // this bookkeeping invisible; the final assignment uses the host's CSS
      // transition and therefore shares the card's 200ms clock.
      const currentHeight = el.getBoundingClientRect().height
      const inlineTransition = el.style.transition
      el.style.transition = "none"
      el.style.height = `${currentHeight}px`
      void el.offsetHeight
      el.style.transition = inlineTransition
      el.style.height = `${targetHeight}px`
      el.style.overflowY = sh > maxHeightPx ? "auto" : "hidden"
    }
    apply()
    const unregister = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
      // Selection-only updates do not change the paragraph geometry.
      if (dirtyElements.size || dirtyLeaves.size) apply()
    })
    const el = editor.getRootElement()
    let width = el?.getBoundingClientRect().width
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => {
      const nextWidth = el?.getBoundingClientRect().width
      if (nextWidth === width) return
      width = nextWidth
      apply()
    })
    if (el) observer?.observe(el)
    return () => {
      unregister()
      observer?.disconnect()
    }
  }, [editor, layoutKey, maxHeightPx])
  return null
}
