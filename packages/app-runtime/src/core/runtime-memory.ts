import { getPlatform } from "@amiba/app-runtime/platform";
import type {
  AgentMemoryTarget,
  AgentMemoryTargetView,
} from "@amiba/app-runtime/platform";

export interface RuntimeMemoryListResponse {
  ok: boolean;
  preset: string;
  targets: AgentMemoryTargetView[];
  error?: string;
}

export async function getRuntimeMemoryList(
  preset?: string,
): Promise<RuntimeMemoryListResponse> {
  const adapter = getPlatform().agentMemory;
  if (!adapter) {
    return {
      ok: false,
      preset: preset ?? "default",
      targets: [],
      error: "This runtime does not expose the DSH memory plugin.",
    };
  }
  try {
    const result = await adapter.list(preset);
    return { ok: true, ...result };
  } catch (error) {
    return {
      ok: false,
      preset: preset ?? "default",
      targets: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function resetRuntimeMemory(
  preset?: string,
  target: AgentMemoryTarget | "all" = "all",
): Promise<{ ok: boolean; deletedIds: string[]; error?: string }> {
  const adapter = getPlatform().agentMemory;
  if (!adapter) {
    return {
      ok: false,
      deletedIds: [],
      error: "This runtime does not expose the DSH memory plugin.",
    };
  }
  try {
    const result = await adapter.reset(preset, target);
    return { ok: true, deletedIds: result.deletedIds };
  } catch (error) {
    return {
      ok: false,
      deletedIds: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
