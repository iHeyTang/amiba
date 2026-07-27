import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin"
import {
  forwardRef,
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
import { TriggerMenuPlugin } from "./plugins/TriggerMenuPlugin"
import type { TriggerProvider } from "./providers/types"

export type { RichComposerHandle } from "./plugins/ImperativeHandlePlugin"

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
    } = props
    return (
      <LexicalComposer initialConfig={baseEditorConfig({ editable: !disabled })}>
        <div className="relative">
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                role="textbox"
                aria-multiline="true"
                spellCheck
                onPaste={onPaste}
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
          <AutoGrowPlugin maxHeightPx={maxHeightPx ?? 200} />
          <MentionSerializePlugin value={value} onChange={onChange} />
          {onSubmitChord && (
            <ImeEnterPlugin onSubmitChord={onSubmitChord} onKeyDownExtra={onKeyDownExtra} />
          )}
          <ImperativeHandlePlugin handleRef={ref} />
          <TriggerMenuPlugin extraProviders={mentionProviders} />
          {children}
        </div>
      </LexicalComposer>
    )
  },
)
