import type { MarkdownExtension } from "@amiba/markdown";
import {
  createSlotContributionsSource,
  type SlotContributionsCtx,
} from "./session-list-sources.js";
export function createMarkdownSource(ctx: SlotContributionsCtx) {
  return createSlotContributionsSource<MarkdownExtension & { order: number }>(
    ctx,
    "amiba.markdown.extension",
    (entry, face) => {
      const extension = face?.extension as MarkdownExtension | undefined;
      if (
        !extension ||
        typeof extension.id !== "string" ||
        typeof extension.version !== "string"
      )
        return null;
      return {
        ...extension,
        order: entry.options.order ?? extension.order ?? 0,
      };
    },
  );
}
