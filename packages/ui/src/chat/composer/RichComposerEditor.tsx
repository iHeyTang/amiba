import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin"
import {
  forwardRef,
  useEffect,
  type ClipboardEventHandler,
  type CSSProperties,
  type ReactNode,
} from "react"
import { cn } from "../../primitives"
import { baseEditorConfig } from "./lexical-config"
import { AutoGrowPlugin } from "./plugins/AutoGrowPlugin"
import { ImeEnterPlugin } from "./plugins/ImeEnterPlugin"
import { ImperativeHandlePlugin, type RichComposerHandle } from "./plugins/ImperativeHandlePlugin"
import { MentionSerializePlugin } from "./plugins/MentionSerializePlugin"
import { OfficialTriggerPlugin } from "./plugins/OfficialTriggerPlugin"
import { TriggerMenuPlugin } from "./plugins/TriggerMenuPlugin"
import { useComposerTriggers, type ComposerTriggerSession } from "./triggers/session"
import type { TriggerProvider } from "./providers/types"

export type { RichComposerHandle } from "./plugins/ImperativeHandlePlugin"

function EditableStatePlugin({ disabled }: { disabled?: boolean }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => { editor.setEditable(!disabled) }, [editor, disabled])
  return null
}

export interface RichComposerEditorProps {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  style?: CSSProperties
  /** Max height in px before the editor switches to scrolling. Defaults to 200. */
  maxHeightPx?: number
  /** Called when Enter / Cmd+Enter / Ctrl+Enter is pressed (not during IME). */
  onSubmitChord?: () => void
  /** Extra keydown hook inside KEY_ENTER_COMMAND; return true to swallow. */
  onKeyDownExtra?: (e: KeyboardEvent) => boolean | void
  /**
   * Pass-through paste handler on the editable surface. Composer uses this
   * to keep paste-to-attach working: the attachments hook's handlePaste
   * only intercepts when the clipboard carries Files; plain text paste
   * still falls through to Lexical.
   */
  onPaste?: ClipboardEventHandler<HTMLElement>
  /** Extra plugins rendered inside the Lexical context (mentions, slash, etc.). */
  children?: ReactNode
  /** Additional @ / slash mention providers, merged with the built-in registry. */
  mentionProviders?: TriggerProvider[]
  /** Active runtime session used for scoped DSH Skill/Command discovery. */
  sessionId?: string
  /**
   * The composer's trigger session (`useComposerTriggers`). Decides which of
   * the TWO mount paths runs — and only one of them ever does, so exactly one
   * menu exists per composer:
   *
   *   - `trigger.official` → `OfficialTriggerPlugin` drives the official
   *     per-session controller and the menu renders from the shadowed
   *     `conversation.input.overlay` seat (outside this editor);
   *   - otherwise → `TriggerMenuPlugin` detects locally and renders the same
   *     `TriggerMenu` from the surface-local provider registry.
   *
   * Absent entirely (older embedders) the local path runs with a throwaway
   * session, exactly as before the adoption.
   */
  trigger?: ComposerTriggerSession
}

export const RichComposerEditor = forwardRef<RichComposerHandle, RichComposerEditorProps>(
  function RichComposerEditor(props, ref) {
    const {
      value,
      onChange,
      placeholder,
      disabled,
      className,
      style,
      maxHeightPx,
      onSubmitChord,
      onKeyDownExtra,
      onPaste,
      children,
      mentionProviders,
      sessionId,
      trigger,
    } = props
    return (
      <LexicalComposer initialConfig={baseEditorConfig({ editable: !disabled })}>
        <div className="relative">
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                data-auto-grow-editor=""
                role="textbox"
                aria-multiline="true"
                spellCheck
                onPaste={disabled ? undefined : onPaste}
                style={style}
                className={cn(
                  "resize-none overflow-hidden border-0 bg-transparent text-sm outline-none",
                  className,
                )}
              />
            }
            placeholder={
              placeholder ? (
                // Mirror the ContentEditable's padding (`className` carries it,
                // e.g. hero's `px-5 pt-4`) onto the overlay so the placeholder
                // text starts exactly where typed text would. `inset-0` makes the
                // overlay's content box match the editor's — without the shared
                // padding the placeholder pins to the raw top-left corner.
                <div
                  className={cn(
                    "pointer-events-none absolute inset-0 select-none text-sm text-muted-foreground",
                    className,
                  )}
                >
                  {placeholder}
                </div>
              ) : null
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <EditableStatePlugin disabled={disabled} />
          <AutoGrowPlugin
            maxHeightPx={maxHeightPx ?? 200}
            layoutKey={className}
          />
          <MentionSerializePlugin value={value} onChange={onChange} />
          {onSubmitChord && !disabled && (
            <ImeEnterPlugin onSubmitChord={onSubmitChord} onKeyDownExtra={onKeyDownExtra} />
          )}
          <ImperativeHandlePlugin handleRef={ref} />
          <TriggerMounts
            mentionProviders={mentionProviders}
            sessionId={sessionId}
            trigger={trigger}
          />
          {children}
        </div>
      </LexicalComposer>
    )
  },
)

/**
 * Mount EXACTLY ONE of the two trigger paths.
 *
 * This is the single place the choice is made, and it is exclusive by
 * construction — which is what acceptance-tests as "exactly one menu renders
 * in-session". The official path contributes no menu of its own here: the
 * menu for that path lives in the shadowed `conversation.input.overlay` seat,
 * rendered by the host from the same `TriggerMenu` component.
 */
function TriggerMounts({
  mentionProviders,
  sessionId,
  trigger,
}: {
  mentionProviders?: TriggerProvider[]
  sessionId?: string
  trigger?: ComposerTriggerSession
}) {
  // Always called (hooks rule); used only when the embedder passed none.
  const fallback = useComposerTriggers({ sessionId })
  const session = trigger ?? fallback
  if (session.official) return <OfficialTriggerPlugin trigger={session} />
  return (
    <TriggerMenuPlugin
      extraProviders={mentionProviders}
      sessionId={sessionId}
      trigger={session}
    />
  )
}
