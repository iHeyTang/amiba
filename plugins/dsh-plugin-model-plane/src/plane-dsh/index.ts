import type { ModelDefinition } from "@amiba/app-runtime/platform";

import type { ModelProviderProfile } from "../plane/types.js";

export interface DshProjectionBinding {
  settingsNs: "llm-deepseek" | "llm-pi-ai";
  settingsPath: string[];
}

export function bindingForDshProvider(
  provider: ModelProviderProfile,
): DshProjectionBinding {
  if (provider.id === "deepseek-official") {
    return { settingsNs: "llm-deepseek", settingsPath: [] };
  }
  return { settingsNs: "llm-pi-ai", settingsPath: ["providers", provider.id] };
}

export function apiForDshProvider(provider: ModelProviderProfile): string {
  if (provider.protocol === "provider-native") {
    throw new Error(
      `DSH has no execution adapter for provider-native profile ${provider.id}`,
    );
  }
  return provider.protocol === "deepseek-chat-completions"
    ? "openai-completions"
    : provider.protocol;
}

function commonModelRow(model: ModelDefinition) {
  return {
    id: model.id,
    name: model.name,
    ...(model.description ? { description: model.description } : {}),
    ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
  };
}

const DSH_REASONING_LEVELS = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

function reasoningEfforts(
  model: ModelDefinition,
): false | Record<string, string | null> {
  if (!model.reasoning?.efforts.length) return false;
  return Object.fromEntries(
    model.reasoning.efforts.map((effort) => {
      if (!DSH_REASONING_LEVELS.has(effort.id)) {
        throw new Error(
          `DSH llm-pi-ai cannot project reasoning effort ${effort.id} on model ${model.id}`,
        );
      }
      const wire =
        effort.wireValue === undefined
          ? effort.id === "off"
            ? null
            : effort.id
          : effort.wireValue;
      if (wire === null && effort.id !== "off") {
        throw new Error(
          `DSH llm-pi-ai requires a wire value for reasoning effort ${effort.id} on model ${model.id}`,
        );
      }
      return [effort.id, wire];
    }),
  );
}

/** Model rows for DSH's dedicated DeepSeek adapter. */
export function deepSeekModelRows(models: readonly ModelDefinition[]) {
  return models.filter((model) => model.enabled !== false).map(commonModelRow);
}

/** Model rows for DSH's generic pi-ai adapter, including exact capabilities. */
export function piAiModelRows(models: readonly ModelDefinition[]) {
  return models
    .filter((model) => model.enabled !== false)
    .map((model) => ({
      ...commonModelRow(model),
      ...(model.inputModalities?.length
        ? {
            input: model.inputModalities.filter(
              (modality): modality is "text" | "image" =>
                modality === "text" || modality === "image",
            ),
          }
        : {}),
      reasoningEfforts: reasoningEfforts(model),
    }));
}
