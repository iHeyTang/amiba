import type { ReactNode } from "react"
import type { LexicalEditor } from "lexical"

export type BuiltinMentionType =
  | "skill"
  | "session"
  | "file"
  | "page"
  /**
   * The official reference occurrence minted from an `{ insert }`
   * `PickOutcome`. Its payload names the owning `InputTriggerSource`, so the
   * model form comes from that source's `ReferenceCodec` — never from a
   * per-type serializer duplicated in the composer.
   */
  | "dsh.reference"

// Built-in types plus dynamic registry keys (`<integration>.<type>`, e.g.
// "amiba.extension") contributed by managed extension providers. The
// `string & {}` keeps editor autocomplete
// for the builtins while accepting any registry key.
export type MentionType = BuiltinMentionType | (string & {})

export interface MentionData {
  type: MentionType
  payload: Record<string, string>
  display: string
}

export interface MenuItem {
  id: string
  label: string
  description?: string
  icon?: ReactNode
  insert?: MentionData            // @ 类：插入芯片
  action?: () => void             // slash UI 动作类：选中即执行
  raw?: string                    // slash 文本类：插入的命令文本
  subcommands?: string[]          // slash：进入二级补全
}

/**
 * The trigger-hit context a surface-local search / pick runs under. Carries
 * the two facts the OFFICIAL `CandidateRequest` and `InputTriggerPick` carry
 * that a bare query string cannot: where the token sits, and which draft
 * range the pick must replace. Optional so the ~dozen existing external
 * providers (host-supplied `mentionProviders`) keep compiling untouched.
 */
export interface TriggerHitContext {
  /** leading = the trimmed draft starts with the token; else inline. */
  position: "leading" | "inline"
  /** Trigger-draft range of the token, and the revision it was read at. */
  span: { start: number; end: number; draftRev: number }
}

export interface TriggerProvider {
  trigger: "/" | "@"
  id: string
  group?: string
  ownsType?: MentionType
  match(query: string): boolean | number
  search(query: string, hit?: TriggerHitContext): Promise<MenuItem[]>
  onSelect(item: MenuItem, editor: LexicalEditor, hit?: TriggerHitContext): void
  serialize?(mention: MentionData): string
  /** Resolve a selected Resource at send time and inject its current content. */
  resolveMention?(mention: MentionData): Promise<string>
  /**
   * This provider's search needs a non-empty query — it can't list a default
   * set. With an empty query the menu skips the search and shows `emptyHint`
   * as the category's empty state instead of dropping the group.
   */
  requiresQuery?: boolean
  /** Empty-state prompt shown for a `requiresQuery` provider with no query. */
  emptyHint?: string
  /**
   * Keep this provider's category in the menu even when it has no results —
   * the content pane shows an empty state ("no results") instead of the group
   * vanishing. Used for stable mention-source categories; built-in providers
   * stay query-filtered so empty ones don't clutter the menu.
   */
  persistent?: boolean
}

/**
 * One @/slash menu category. The plugin builds these (clustered by provider
 * `group`); `TriggerMenu` renders the sidebar from them. A group with no
 * `items` but a `hint` is a "needs a query" category — its right pane shows the
 * hint instead of results.
 */
export interface MenuGroup {
  label: string
  items: MenuItem[]
  hint?: string
}
