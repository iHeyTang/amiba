import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { useLayoutEffect } from "react"

interface AutoGrowPluginProps {
  maxHeightPx: number
  /** Re-measure when density/padding classes change without an editor update. */
  layoutKey?: string
}

function measureIntrinsicHeight(el: HTMLElement): number {
  const clone = el.cloneNode(true) as HTMLElement
  const width = el.getBoundingClientRect().width
  clone.removeAttribute("id")
  clone.setAttribute("aria-hidden", "true")
  clone.style.position = "fixed"
  clone.style.inset = "0 auto auto -100000px"
  clone.style.width = `${width}px`
  clone.style.height = "auto"
  clone.style.maxHeight = "none"
  clone.style.overflow = "visible"
  clone.style.pointerEvents = "none"
  clone.style.transition = "none"
  clone.style.visibility = "hidden"

  ;(el.parentElement ?? document.body).appendChild(clone)
  const height = clone.scrollHeight
  clone.remove()
  return height
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
    return editor.registerUpdateListener(() => apply())
  }, [editor, layoutKey, maxHeightPx])
  return null
}
