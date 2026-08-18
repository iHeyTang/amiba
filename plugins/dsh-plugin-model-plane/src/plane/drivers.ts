import type { ModelProviderProfile } from "./types.js";

const DEEPSEEK_REASONING = {
  efforts: [
    { id: "off", name: "Off", wireValue: null },
    { id: "high", name: "High", wireValue: "high" },
    { id: "max", name: "Max", wireValue: "max" },
  ],
  defaultEffort: "high",
};

const DEEPSEEK_MODEL_NAMES: Record<string, string> = {
  "deepseek-v4-flash": "DeepSeek V4 Flash",
  "deepseek-v4-pro": "DeepSeek V4 Pro",
};

/** Built-in metadata belongs to provider drivers, never to a harness catalog. */
export function builtInModelProviders(): ModelProviderProfile[] {
  return [
    {
      id: "deepseek-official",
      displayName: "DeepSeek",
      protocol: "deepseek-chat-completions",
      baseURL: "https://api.deepseek.com",
      credentialRef: "DEEPSEEK_API_KEY",
      enabled: true,
      editable: true,
      source: "builtin",
      models: [
        {
          id: "deepseek-v4-flash",
          name: "DeepSeek V4 Flash",
          contextWindow: 1_000_000,
          maxTokens: 256_000,
          inputModalities: ["text"],
          reasoning: DEEPSEEK_REASONING,
        },
        {
          id: "deepseek-v4-pro",
          name: "DeepSeek V4 Pro",
          contextWindow: 1_000_000,
          maxTokens: 256_000,
          inputModalities: ["text"],
          reasoning: DEEPSEEK_REASONING,
        },
      ],
    },
  ];
}

/** Apply capability metadata supplied by the selected provider driver. */
export function applyModelProviderCapabilities(
  provider: ModelProviderProfile,
): ModelProviderProfile {
  if (provider.id !== "deepseek-official") return provider;
  return {
    ...provider,
    models: provider.models.map((model) => ({
      ...model,
      ...(model.name.trim().toLocaleLowerCase() ===
        model.id.trim().toLocaleLowerCase() && DEEPSEEK_MODEL_NAMES[model.id]
        ? { name: DEEPSEEK_MODEL_NAMES[model.id] }
        : {}),
      inputModalities: model.inputModalities ?? ["text"],
      reasoning: model.reasoning ?? DEEPSEEK_REASONING,
    })),
  };
}
