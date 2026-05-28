import { Button, Textarea } from "@hermes-x/ui"
import { cn } from "@hermes-x/utils"
import { ArrowUp, Square } from "lucide-react"
import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react"

interface Props {
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
  /** When true, the send button becomes a stop button calling `onAbort`. */
  busy?: boolean
  onAbort?: () => void
  placeholder?: string
  /**
   * Optional row rendered above the textarea — extension uses this for the
   * page-context chip / Learn record button / NavigateOpenPolicyToggle.
   * Desktop typically leaves it undefined.
   */
  extrasAbove?: ReactNode
  /** Optional row rendered below the textarea, left side (e.g. status pill). */
  extrasBelow?: ReactNode
}

const MAX_TEXTAREA_PX = 200

export function Composer({
  value,
  onChange,
  onSubmit,
  busy,
  onAbort,
  placeholder = "Send a message…",
  extrasAbove,
  extrasBelow
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)

  // Auto-grow up to MAX_TEXTAREA_PX; switch to scroll past that.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    const sh = el.scrollHeight
    const next = Math.min(sh, MAX_TEXTAREA_PX)
    el.style.height = `${next}px`
    el.style.overflowY = sh > MAX_TEXTAREA_PX ? "auto" : "hidden"
  }, [value])

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (busy || !value.trim()) return
      onSubmit()
    }
  }

  function onSendClick() {
    if (busy) {
      onAbort?.()
      return
    }
    if (!value.trim()) return
    onSubmit()
  }

  return (
    <div className="border-t border-border bg-background">
      {extrasAbove ? <div className="px-3 pt-2">{extrasAbove}</div> : null}
      <div className="flex items-end gap-2 p-3">
        <Textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={1}
          className={cn(
            "min-h-[36px] resize-none border-border bg-background",
            "focus-visible:ring-1 focus-visible:ring-ring"
          )}
        />
        <Button
          type="button"
          size="icon"
          variant={busy ? "secondary" : "default"}
          onClick={onSendClick}
          disabled={!busy && !value.trim()}
          aria-label={busy ? "Abort" : "Send"}>
          {busy ? <Square className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
        </Button>
      </div>
      {extrasBelow ? (
        <div className="px-3 pb-2 text-xs text-muted-foreground">{extrasBelow}</div>
      ) : null}
    </div>
  )
}
