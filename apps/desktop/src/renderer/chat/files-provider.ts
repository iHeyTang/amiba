import type { LexicalEditor } from "lexical"
import { insertMentionAtTrigger } from "@hermes-x/ui"
import type { MenuItem, MentionData, TriggerProvider } from "@hermes-x/ui"

/**
 * Desktop `@file` mention provider. Lists the active session's bound
 * workspace dir (top level only) via the `files:list` IPC bridge and maps
 * each row into a composer menu item. `getSessionId` is a getter so the
 * provider always lists against the currently-active session rather than a
 * stale id captured at construction time.
 */
export function makeDesktopFilesProvider(getSessionId: () => string): TriggerProvider {
  return {
    trigger: "@",
    id: "files",
    group: "Files",
    ownsType: "file",
    match: () => true,
    async search(query: string): Promise<MenuItem[]> {
      const rows = await window.hermes.files.list(getSessionId(), query)
      return rows.map((r) => ({
        id: `files:${r.path}`,
        label: r.path.split("/").pop() || r.path,
        description: r.path,
        insert: { type: "file", payload: { path: r.path }, display: r.path.split("/").pop() || r.path } as MentionData,
      }))
    },
    onSelect(item: MenuItem, editor: LexicalEditor) {
      if (item.insert) insertMentionAtTrigger(editor, item.insert)
    },
    serialize(m: MentionData): string {
      return m.payload.path
    },
  }
}
