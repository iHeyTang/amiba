/**
 * Pure utility helpers used by the chat bubble renderer.
 *
 *   - {@link bubbleTextContent}    — defensive content coercion before passing
 *                                    a message body into Streamdown.
 *   - {@link splitThinkingFromBody} — extract `<think>` / `<reasoning>` /
 *                                    `<scratchpad>` blocks from an assistant
 *                                    text so they can render in the dedicated
 *                                    reasoning channel.
 *   - {@link formatToolDuration}   — ms → "123ms" / "1.5s" / "1m 30s".
 */

// Streamdown assumes string children; its code path uses `.length` / `.split`
// on the markdown source. Persisted sessions or edge cases may still surface
// null or non-string `content`, which would otherwise crash inside Streamdown.
export function bubbleTextContent(content: unknown): string {
  if (typeof content === "string") return content
  if (content == null) return ""
  return String(content)
}

/** Hide agent-only Applet Resource payloads while retaining the visible @label. */
export function stripManagedResourceContext(text: string): string {
  return text
    .replace(/(?:[ \t]*\r?\n)?[ \t]*<amiba-resource\b[^>]*>[\s\S]*?<\/amiba-resource>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()
}

/**
 * Remove the internal workspace instruction that the desktop engine prepends
 * to a user turn while retaining its bound directory as renderable metadata.
 *
 * Fresh local messages carry `UiMessage.workspacePath`; persisted Hermes
 * history may only contain the legacy `<workspace>` block, so the bubble
 * renderer needs both paths during migration.
 */
export function splitWorkspaceFromBody(text: string): {
  body: string
  workspacePath: string
} {
  let workspacePath = ""
  const body = text.replace(
    /<workspace(?:\s[^>]*)?>([\s\S]*?)<\/workspace>/gi,
    (_block, inner: string) => {
      const pathMatch = inner.match(
        /(?:^|\n)[ \t]*Bound directory:[ \t]*(.+?)[ \t]*(?=\r?\n|$)/i,
      )
      const path = pathMatch?.[1]?.trim()
      if (path) workspacePath = path
      return ""
    },
  )

  return {
    body: body
      .replace(/^(?:[ \t]*\r?\n)+/, "")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd(),
    workspacePath,
  }
}

/**
 * Pull `<think>` / `<reasoning>` / `<scratchpad>` blocks out of an assistant
 * message body so they can be rendered through the existing "reasoning trace"
 * slot (smaller, muted, hideable) instead of leaking inline into the answer.
 *
 * Why this lives client-side: some upstream gateways forward the model's raw
 * stream verbatim (tags included) into `delta.content` instead of routing
 * them to `reasoning_content`. Streamdown then strips the unknown HTML-ish
 * tags at render time but keeps the content between them, so the user sees
 * the thinking prose blended with the actual answer at the same font size —
 * and the "hide thinking" toggle does nothing because the text never made it
 * into the reasoning channel.
 *
 * Handles streaming: if an opening tag has no closing tag yet (we haven't
 * received it), everything from the opener to end-of-text is treated as
 * in-progress thinking. The next render pass will see the full block once
 * the closer arrives.
 *
 * Returns the cleaned-up body plus any extracted thinking text (multiple
 * blocks joined with blank lines). Both fields are trimmed; either may be
 * empty.
 */
export function splitThinkingFromBody(text: string): { body: string; thinking: string } {
  if (!text || !text.includes("<")) {
    return { body: text, thinking: "" }
  }
  // Non-greedy `[\s\S]*?` so back-to-back blocks don't get glued.
  // The `(?:</\1>|$)` alternation closes an unterminated block at end-of-text,
  // covering the streaming case where the closer hasn't arrived yet.
  const re = /<(think|reasoning|scratchpad)>([\s\S]*?)(?:<\/\1>|$)/gi
  const parts: string[] = []
  let body = ""
  let lastEnd = 0
  for (const match of text.matchAll(re)) {
    if (match.index === undefined) continue
    body += text.slice(lastEnd, match.index)
    const inner = (match[2] ?? "").trim()
    if (inner) parts.push(inner)
    lastEnd = match.index + match[0].length
  }
  body += text.slice(lastEnd)
  return {
    body: body.replace(/\n{3,}/g, "\n\n").trim(),
    thinking: parts.join("\n\n").trim()
  }
}

/**
 * Format an elapsed wall-clock duration for a tool-progress chip:
 *   < 1s    → "123ms"   (millisecond precision; chips that flicker between
 *                        200ms and 800ms don't read as smooth)
 *   < 1m    → "1.5s"    (one decimal; keeps the chip visually stable while
 *                        the user's reading)
 *   ≥ 1m    → "Xm Ys"   (minute-scale switches to mm ss so long-running
 *                        scrapes read cleanly)
 */
/** Extract the hostname from a URL, returning `""` for malformed/empty input. */
export function hostnameOf(url: string | undefined): string {
  if (!url) return ""
  try {
    return new URL(url).hostname
  } catch {
    return ""
  }
}

export function formatToolDuration(ms: number): string {
  if (ms < 0) return "0ms"
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const totalSec = Math.round(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec - m * 60
  return `${m}m ${s}s`
}
