import { listChannels } from "@hermes-x/core"
import type { LexicalEditor } from "lexical"
import { insertMentionAtTrigger } from "./skills"
import type { MenuItem, MentionData, TriggerProvider } from "./types"

export function makeChannelsProvider(): TriggerProvider {
  return {
    trigger: "@",
    id: "channels",
    group: "Channels",
    ownsType: "channel",
    match: () => true,
    async search(query: string): Promise<MenuItem[]> {
      const q = query.toLowerCase()
      return listChannels()
        .filter((c) => c.fallbackLabel.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
        .slice(0, 15)
        .map((c) => ({
          id: `channels:${c.id}`,
          label: c.fallbackLabel,
          insert: { type: "channel", payload: { id: c.id }, display: c.fallbackLabel } as MentionData,
        }))
    },
    onSelect(item: MenuItem, editor: LexicalEditor) {
      if (item.insert) insertMentionAtTrigger(editor, item.insert)
    },
    serialize(m: MentionData): string {
      return `(channel: ${m.payload.id})`
    },
  }
}
