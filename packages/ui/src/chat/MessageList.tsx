import type { ChatMessage } from "@amiba/core"
import { ScrollArea } from "../primitives"
import { cn } from "../primitives"
import { useEffect, useRef } from "react"

interface Props {
  messages: ChatMessage[]
  /** Optional caret/pending indicator at the tail (e.g. "streaming…"). */
  pendingIndicator?: React.ReactNode
  /** Optional empty-state element when there are no messages yet. */
  emptyState?: React.ReactNode
}

/**
 * Scrollable list of chat bubbles. Auto-scrolls to bottom on new content
 * unless the user has manually scrolled away.
 */
export function MessageList({ messages, pendingIndicator, emptyState }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  useEffect(() => {
    if (!stickToBottom.current) return
    const el = viewportRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, pendingIndicator])

  function onScroll() {
    const el = viewportRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottom.current = distFromBottom < 32
  }

  if (messages.length === 0 && emptyState) {
    return <div className="flex h-full items-center justify-center">{emptyState}</div>
  }

  return (
    <ScrollArea className="h-full">
      <div ref={viewportRef} onScroll={onScroll} data-selection="text" className="flex flex-col gap-3 p-4">
        {messages.map((m) => (
          <MessageBubble key={m.uiId ?? `${m.role}-${m.content.slice(0, 16)}`} message={m} />
        ))}
        {pendingIndicator}
      </div>
    </ScrollArea>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user"
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground border border-border"
        )}>
        {message.content || (isUser ? "" : <span className="text-muted-foreground italic">…</span>)}
      </div>
    </div>
  )
}
