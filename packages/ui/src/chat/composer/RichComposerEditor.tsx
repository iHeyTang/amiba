import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin"
import type { CSSProperties, ReactNode } from "react"
import { cn } from "../../primitives"
import { baseEditorConfig } from "./lexical-config"
import { ValueSyncPlugin } from "./plugins/ValueSyncPlugin"

export interface RichComposerEditorProps {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  style?: CSSProperties
  /** Extra plugins rendered inside the Lexical context (mentions, slash, etc.). */
  children?: ReactNode
}

export function RichComposerEditor(props: RichComposerEditorProps) {
  const { value, onChange, placeholder, disabled, className, style, children } =
    props
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
        <ValueSyncPlugin value={value} onChange={onChange} />
        {children}
      </div>
    </LexicalComposer>
  )
}
