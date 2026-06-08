import { getHermesSkills } from "@hermes-x/core"
import { $getSelection, $isRangeSelection, type LexicalEditor } from "lexical"
import { $createMentionNode } from "../MentionNode"
import type { MenuItem, MentionData, TriggerProvider } from "./types"

let cache: { name: string; description: string }[] | null = null

async function load() {
  if (cache) return cache
  const res = await getHermesSkills()
  cache = res.ok ? res.skills.filter((s) => s.enabled).map((s) => ({ name: s.name, description: s.description })) : []
  return cache
}

export function makeSkillsProvider(): TriggerProvider {
  return {
    trigger: "@",
    id: "skills",
    group: "Skills",
    ownsType: "skill",
    match: () => true,
    async search(query: string): Promise<MenuItem[]> {
      const q = query.toLowerCase()
      const skills = await load()
      return skills
        .filter((s) => s.name.toLowerCase().includes(q))
        .slice(0, 20)
        .map((s) => ({
          id: `skills:${s.name}`,
          label: s.name,
          description: s.description,
          insert: { type: "skill", payload: { name: s.name }, display: s.name } as MentionData,
        }))
    },
    onSelect(item: MenuItem, editor: LexicalEditor) {
      if (!item.insert) return
      insertMentionAtTrigger(editor, item.insert)
    },
    serialize(m: MentionData): string {
      return `(skill: ${m.payload.name})`
    },
  }
}

/** Replace the open trigger run (e.g. "@trans") with a MentionNode + trailing space. Reused by all @ providers. */
export function insertMentionAtTrigger(editor: LexicalEditor, mention: MentionData) {
  editor.update(() => {
    const sel = $getSelection()
    if (!$isRangeSelection(sel) || !sel.isCollapsed()) return
    const node = sel.anchor.getNode()
    const offset = sel.anchor.offset
    const text = node.getTextContent()
    const before = text.slice(0, offset)
    const m = /([/@])([^\s]*)$/.exec(before)
    if (!m) return
    const triggerStart = offset - m[0].length
    if (typeof (node as { spliceText?: unknown }).spliceText === "function") {
      ;(node as unknown as { spliceText: (i: number, n: number, t: string) => void }).spliceText(
        triggerStart, m[0].length, "",
      )
    }
    const chip = $createMentionNode(mention)
    sel.insertNodes([chip])
    sel.insertText(" ")
  })
}
