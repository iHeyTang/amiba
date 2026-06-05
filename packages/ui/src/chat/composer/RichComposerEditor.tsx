import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin"
import { forwardRef, type CSSProperties, type ReactNode } from "react"
import { cn } from "../../primitives"
import { baseEditorConfig } from "./lexical-config"
import { AutoGrowPlugin } from "./plugins/AutoGrowPlugin"
import { ImeEnterPlugin } from "./plugins/ImeEnterPlugin"
import { ImperativeHandlePlugin, type RichComposerHandle } from "./plugins/ImperativeHandlePlugin"
import { ValueSyncPlugin } from "./plugins/ValueSyncPlugin"

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
  /** Extra plugins rendered inside the Lexical context (mentions, slash, etc.). */
  children?: ReactNode
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
      children,
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
                style={style}
                className={cn(
                  "resize-none overflow-hidden border-0 bg-transparent text-sm outline-none",
                  className,
                )}
              />
            }
            placeholder={
              placeholder ? (
                <div className="pointer-events-none absolute left-0 top-0 select-none text-sm text-muted-foreground">
                  {placeholder}
                </div>
              ) : null
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <AutoGrowPlugin maxHeightPx={maxHeightPx ?? 200} />
          <ValueSyncPlugin value={value} onChange={onChange} />
          {onSubmitChord && (
            <ImeEnterPlugin onSubmitChord={onSubmitChord} onKeyDownExtra={onKeyDownExtra} />
          )}
          <ImperativeHandlePlugin handleRef={ref} />
          {children}
        </div>
      </LexicalComposer>
    )
  },
)
