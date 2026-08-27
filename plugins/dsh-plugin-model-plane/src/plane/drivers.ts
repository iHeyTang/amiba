import type { ModelProviderProfile } from "./types.js";

/**
 * Connection seed for the provider Amiba ships enabled out of the box.
 *
 * IDENTITY AND CONNECTION ONLY — no capability claims. Context window, output
 * cap, reasoning ladder and input modalities all belong to the provider and to
 * DSH's own adapter, and this driver has no way to know them for a model that
 * did not exist when the file was written.
 *
 * The table that used to live here was both redundant and wrong:
 *
 *   - Redundant: `@deepseek-ai/dsh-llm-deepseek` already ships this exact
 *     model list as its own `DEFAULT_MODELS`, defaults an unlisted id to a
 *     1,000,000-token context and a 256,000-token output cap, and exposes the
 *     off/high/max reasoning ladder for every pass-through model.
 *     `ctx.llm.resolveModelInfo` is the authority at request time.
 *   - Wrong: filling the gaps with `?? ["text"]` and `?? DEEPSEEK_REASONING`
 *     asserted facts about models nobody here had ever seen. Downstream reads
 *     those assertions as authoritative — a fabricated reasoning ladder is put
 *     on the wire, and a fabricated modality set is checked against image
 *     input.
 *
 * Real numbers arrive from discovery, which reads `context_window`,
 * `max_output_tokens` and `input_modalities` off the provider's own `/models`
 * response. Until a model is discovered it simply carries no claims, which is
 * the honest state rather than a plausible-looking guess.
 */
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
      // Ids so the picker is not empty before the first discovery. Names are
      // presentation, not capability; everything else is left to be learned.
      models: [
        { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
        { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
      ],
    },
  ];
}
