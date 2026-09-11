import type { Protocol } from "./catalog.js";

// Exact model + protocol contracts, verified 2026-09-10. Never infer reasoning
// capabilities from a name prefix or another provider's model catalog.
// K3: https://tokendance.space/docs/kimi-thinking-models.md
//     https://platform.kimi.com/docs/guide/use-reasoning-effort
// Flash 0731 Responses: https://tokendance.space/docs/codex
//     https://au-tokendance.tos-cn-shanghai.volces.com/public/models.json
const contracts: Record<string, {
  api: Protocol;
  efforts: Record<string, string | null>;
}> = {
  "kimi-k3": {
    api: "openai-completions",
    efforts: { low: "low", high: "high", max: "max" },
  },
  "deepseek-v4-flash-0731": {
    api: "openai-responses",
    efforts: { off: "none", high: "high" },
  },
};

export function reasoningContract(id: string) {
  return Object.hasOwn(contracts, id) ? contracts[id] : undefined;
}
