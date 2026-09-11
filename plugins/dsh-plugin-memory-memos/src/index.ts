import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { registerToolSource } from "@amiba/dsh-plugin-catalog";
import { applyMemoryRemote } from "./remote-service.js";
import { initialMemosStatus } from "./memos-status.js";
import {
  MemoryCorrections,
  registerMemoryCorrectionTool,
} from "./correction.js";
import { MemosDashboardService } from "./dashboard-service.js";
import { mountMemos } from "./memos.js";

export const name = "amiba-memory-memos";
export const inject = ["tools", "systemPrompt", "amibaToolCatalog"];

export interface Config {
  memosRoot: string;
  viewerPort: number;
}

export const Config = z.object({
  memosRoot: z.string().required(),
  viewerPort: z.number().min(1).max(65535).step(1).default(18801),
});

export const MEMOS_TOOLS = [
  "amiba_memory_correct",
  "memos_search",
  "memos_get",
  "memos_timeline",
  "memos_environment",
  "memos_skill_list",
  "memos_skill_get",
] as const;

export async function apply(ctx: Context, config: Config): Promise<void> {
  const status = initialMemosStatus(config.memosRoot);
  const corrections = new MemoryCorrections(
    new MemosDashboardService(() => ({ ...status })),
  );
  applyMemoryRemote(ctx, () => ({ ...status }), corrections);
  registerMemoryCorrectionTool(ctx, corrections);
  for (const tool of MEMOS_TOOLS) {
    registerToolSource(ctx, tool, {
      kind: "dsh-plugin",
      distribution: "builtin",
      id: "amiba-memory",
      name: "MemOS Memory",
      packageName: "@amiba/dsh-plugin-memory-memos",
      loadMode: "plugin",
      executionTarget: "dsh-runtime",
      dynamic: false,
    });
  }
  await mountMemos(ctx, config, status);
}
