import type { LexicalEditor } from "lexical";
import type { WorkspaceFilesAdapter } from "@amiba/app-runtime/platform";

import { insertMentionAtTrigger } from "./composer/providers/skills";
import type {
  MentionData,
  MenuItem,
  TriggerProvider,
} from "./composer/providers/types";

/** Host-neutral @file provider backed by an optional workspace capability. */
export function makeWorkspaceFilesProvider(
  files: WorkspaceFilesAdapter,
  getSessionId: () => string,
): TriggerProvider {
  return {
    trigger: "@",
    id: "files",
    group: "Files",
    ownsType: "file",
    match: () => true,
    async search(query: string): Promise<MenuItem[]> {
      const rows = await files.search(getSessionId(), query);
      return rows.map((row) => {
        const label = row.path.split("/").pop() || row.path;
        return {
          id: `files:${row.path}`,
          label,
          description: row.path,
          insert: {
            type: "file",
            payload: { path: row.path },
            display: label,
          } as MentionData,
        };
      });
    },
    onSelect(item: MenuItem, editor: LexicalEditor) {
      if (item.insert) insertMentionAtTrigger(editor, item.insert);
    },
    serialize(mention: MentionData): string {
      return mention.payload.path;
    },
  };
}
