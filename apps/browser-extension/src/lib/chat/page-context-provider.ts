import type { LexicalEditor } from "lexical"
import { insertMentionAtTrigger } from "@amiba/ui"
import type { MenuItem, MentionData, TriggerProvider } from "@amiba/ui"
import { chromePageContext } from "./chrome-capabilities"

export function makePageContextProvider(): TriggerProvider {
  return {
    trigger: "@",
    id: "pageContext",
    group: "Page",
    ownsType: "page",
    match: () => true,
    async search(query: string): Promise<MenuItem[]> {
      const tab = await chromePageContext.getActiveBrowserTab()
      const items: MenuItem[] = []
      if (tab) {
        const title = tab.title || tab.url || "current tab"
        items.push({
          id: "page:current",
          label: "Current page",
          description: title,
          insert: { type: "page", payload: { tabId: String(tab.id ?? ""), title }, display: title } as MentionData,
        })
      }
      const q = query.toLowerCase()
      return items.filter((i) => i.label.toLowerCase().includes(q) || (i.description ?? "").toLowerCase().includes(q))
    },
    onSelect(item: MenuItem, editor: LexicalEditor) {
      if (item.insert) insertMentionAtTrigger(editor, item.insert)
    },
    serialize(m: MentionData): string {
      return `[page: ${m.payload.title}]`
    },
  }
}
