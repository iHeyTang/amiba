import { getHermesCommands } from "@hermes-x/core"
import { $getSelection, $isRangeSelection, type LexicalEditor } from "lexical"
import type { MenuItem, TriggerProvider } from "./types"
import { slashKindFor } from "./slash-ui-actions"

let cache: { name: string; description: string; aliases: string[]; subcommands: string[] }[] | null = null
async function load() {
  if (cache) return cache
  const res = await getHermesCommands()
  cache = res.ok
    ? res.commands.map((c) => ({ name: c.name, description: c.description, aliases: c.aliases, subcommands: c.subcommands }))
    : []
  return cache
}

export function makeSlashProvider(): TriggerProvider {
  return {
    trigger: "/",
    id: "slash",
    group: "Commands",
    match: () => true,
    async search(query: string): Promise<MenuItem[]> {
      const q = query.toLowerCase()
      const cmds = await load()
      return cmds
        .filter((c) => c.name.toLowerCase().includes(q) || c.aliases.some((a) => a.toLowerCase().includes(q)))
        .slice(0, 30)
        .map((c) => ({
          id: `slash:${c.name}`,
          label: c.name,
          description: c.description,
          raw: `/${c.name} `,
          subcommands: c.subcommands.length ? c.subcommands : undefined,
        }))
    },
    onSelect(item: MenuItem, editor: LexicalEditor) {
      replaceLineWith(editor, item.raw ?? `/${item.label} `)
    },
  }
}

/** Replace the current line's "/query" with the chosen command text. */
function replaceLineWith(editor: LexicalEditor, text: string) {
  editor.update(() => {
    const sel = $getSelection()
    if (!$isRangeSelection(sel) || !sel.isCollapsed()) return
    const node = sel.anchor.getNode()
    const offset = sel.anchor.offset
    const before = node.getTextContent().slice(0, offset)
    const m = /\/([^\s]*)$/.exec(before)
    if (!m) return
    const start = offset - m[0].length
    if (typeof (node as { spliceText?: unknown }).spliceText === "function") {
      ;(node as unknown as { spliceText: (i: number, n: number, t: string) => void }).spliceText(start, m[0].length, text)
    }
  })
}

export { slashKindFor }
