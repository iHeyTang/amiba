export type ModelMetadata = Record<string, unknown>;

export interface NormalizedModelMetadata {
  capabilities: {
    audioInput: boolean;
    audioOutput: boolean;
    fastMode: boolean;
    imageOutput: boolean;
    interleavedReasoning: boolean;
    openWeights: boolean;
    pdfInput: boolean;
    pdfOutput: boolean;
    reasoning: boolean;
    structuredOutput: boolean;
    temperatureControl: boolean;
    tools: boolean;
    videoInput: boolean;
    videoOutput: boolean;
    visionInput: boolean;
  };
  limits: {
    contextWindow: number | null;
    maxInputTokens: number | null;
    maxOutputTokens: number | null;
  };
  modalities: {
    input: string[];
    output: string[];
    unclassifiedInput: string[];
    unclassifiedOutput: string[];
  };
  pricing: {
    cacheRead: unknown;
    cacheWrite: unknown;
    input: unknown;
    output: unknown;
  };
  reference: {
    extras: Array<[string, unknown]>;
    family: string;
    knowledgeCutoff: string;
    releaseDate: string;
    status: string;
  };
}

/**
 * Fields that are useful while scanning a provider's model list.
 *
 * This is deliberately a display allowlist, not a provenance allowlist:
 * provider/runtime metadata and supplemental catalogs may both contribute.
 * Reference-only fields (release date, family, pricing, etc.) stay in the
 * details dialog.
 */
const MODEL_PREVIEW_METADATA_GROUPS = [
  ["reasoning", "supports_reasoning"],
  ["tool_call", "supports_tools"],
  ["vision", "supports_vision", "attachment"],
  ["input_modalities", "modalities", "modality"],
  ["output_modalities"],
  ["context_window", "max_context_tokens"],
  ["max_input_tokens"],
  ["max_output_tokens", "max_tokens"],
] as const;

/**
 * Metadata that remains useful in the details dialog, but is too contextual or
 * provider-specific to guide a general model choice at a glance.
 */
const MODEL_DETAIL_ONLY_METADATA_GROUPS = [
  ["structured_output"],
  ["temperature"],
  ["open_weights"],
  ["fast", "fast_mode"],
  ["interleaved_reasoning"],
] as const;

/**
 * Aliases that describe the same fact. If provider/runtime metadata explicitly
 * supplies any member of a group, supplemental values from the whole group are
 * discarded before the provider value is applied.
 */
const MODEL_METADATA_PRECEDENCE_GROUPS = [
  ...MODEL_PREVIEW_METADATA_GROUPS,
  ...MODEL_DETAIL_ONLY_METADATA_GROUPS,
  ["input_price_per_mtok", "input_price"],
  ["output_price_per_mtok", "output_price"],
  ["cache_read_price_per_mtok", "cache_read_price"],
  ["model_family", "family"],
  ["model_status", "status"],
] as const;

const RECOGNIZED_MODALITIES = new Set([
  "audio",
  "image",
  "pdf",
  "text",
  "video",
]);

const NON_DISPLAY_METADATA_KEYS = new Set<string>([
  ...MODEL_METADATA_PRECEDENCE_GROUPS.flatMap((keys) => [...keys]),
  "cache_write_price_per_mtok",
  "free",
  "knowledge_cutoff",
  "release_date",
  "capabilities_source",
  "context_source",
  "fast_mode_source",
  "pricing_source",
]);

function hasOwn(metadata: ModelMetadata, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(metadata, key);
}

function hasValue(metadata: ModelMetadata, key: string): boolean {
  if (!hasOwn(metadata, key)) return false;
  const value = metadata[key];
  return (
    value !== null &&
    value !== undefined &&
    !(typeof value === "string" && value.trim() === "")
  );
}

function groupHasValue(
  metadata: ModelMetadata,
  keys: readonly string[],
): boolean {
  return keys.some((key) => hasValue(metadata, key));
}

function copyDefinedValues(
  target: ModelMetadata,
  source: ModelMetadata,
  keys?: readonly string[],
): void {
  const entries = keys
    ? keys.map((key) => [key, source[key]] as const)
    : Object.entries(source);
  for (const [key, value] of entries) {
    if (!hasValue(source, key)) continue;
    target[key] = value;
  }
}

/**
 * Merge catalog metadata with semantic provider precedence.
 *
 * `supplemental` is the fallback. Provider/runtime values win both exact-key
 * collisions and alias collisions (`vision` versus `supports_vision`).
 */
export function mergeModelMetadata(
  supplemental: ModelMetadata | undefined,
  provider: ModelMetadata | undefined,
): ModelMetadata {
  const lowerPriority = supplemental ?? {};
  const higherPriority = provider ?? {};
  const merged: ModelMetadata = {};
  copyDefinedValues(merged, lowerPriority);

  for (const keys of MODEL_METADATA_PRECEDENCE_GROUPS) {
    if (!groupHasValue(higherPriority, keys)) continue;
    for (const key of keys) delete merged[key];
    copyDefinedValues(merged, higherPriority, keys);
  }

  copyDefinedValues(merged, higherPriority);

  const providerVision = readExplicitBoolean(higherPriority, [
    "vision",
    "supports_vision",
    "attachment",
  ]);
  const providerHasModalities = groupHasValue(higherPriority, [
    "input_modalities",
    "modalities",
    "modality",
  ]);
  if (providerVision === false && !providerHasModalities) {
    for (const key of ["input_modalities", "modalities", "modality"]) {
      if (!hasValue(merged, key)) continue;
      merged[key] = withoutImageModality(merged[key]);
    }
  }

  return merged;
}

function readExplicitBoolean(
  metadata: ModelMetadata,
  keys: readonly string[],
): boolean | undefined {
  for (const key of keys) {
    if (typeof metadata[key] === "boolean") return metadata[key] as boolean;
  }
  return undefined;
}

function readPositiveNumber(
  metadata: ModelMetadata,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return null;
}

function readText(metadata: ModelMetadata, keys: readonly string[]): string {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readFirstValue(
  metadata: ModelMetadata,
  keys: readonly string[],
): unknown {
  for (const key of keys) {
    if (hasValue(metadata, key)) return metadata[key];
  }
  return undefined;
}

function canonicalizeModality(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  const aliases: Record<string, string> = {
    "application/pdf": "pdf",
    document: "pdf",
    documents: "pdf",
    images: "image",
    pictures: "image",
    vision: "image",
    sounds: "audio",
    videos: "video",
  };
  return aliases[normalized] ?? normalized;
}

function modalityTokens(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => modalityTokens(item));
  }
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.toLowerCase() === "application/pdf") return ["pdf"];
  return trimmed
    .split(/[,|+\s]+/)
    .map(canonicalizeModality)
    .filter(Boolean);
}

function pushUnique(target: string[], values: string[]): void {
  for (const value of values) {
    if (!target.includes(value)) target.push(value);
  }
}

function resolveModelModalities(metadata: ModelMetadata): {
  input: string[];
  output: string[];
} {
  const input: string[] = [];
  const output: string[] = [];
  pushUnique(input, modalityTokens(metadata.input_modalities));
  pushUnique(output, modalityTokens(metadata.output_modalities));

  for (const key of ["modalities", "modality"]) {
    const value = metadata[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const directional = value as Record<string, unknown>;
      pushUnique(input, modalityTokens(directional.input));
      pushUnique(output, modalityTokens(directional.output));
      continue;
    }
    if (typeof value === "string" && value.includes("->")) {
      const [rawInput, rawOutput] = value.split("->", 2);
      pushUnique(input, modalityTokens(rawInput));
      pushUnique(output, modalityTokens(rawOutput));
      continue;
    }
    pushUnique(input, modalityTokens(value));
  }

  return { input, output };
}

function withoutImageModality(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter(
      (item) => canonicalizeModality(String(item)) !== "image",
    );
  }
  if (typeof value === "string") {
    if (value.includes("->")) {
      const [rawInput, rawOutput] = value.split("->", 2);
      const input = modalityTokens(rawInput).filter((item) => item !== "image");
      const output = modalityTokens(rawOutput);
      return `${input.join("+")}->${output.join("+")}`;
    }
    return modalityTokens(value).filter((item) => item !== "image");
  }
  if (value && typeof value === "object") {
    const directional = value as Record<string, unknown>;
    return {
      ...directional,
      input: withoutImageModality(directional.input),
    };
  }
  return value;
}

/**
 * Convert source-shaped metadata into a single semantic model for rendering.
 *
 * Alias fields are collapsed, directional modalities are parsed, and
 * capabilities derived from modalities are represented only once. Consumers
 * should render this result instead of interpreting raw provider fields.
 */
export function normalizeModelMetadata(
  metadata: ModelMetadata = {},
): NormalizedModelMetadata {
  const modalities = resolveModelModalities(metadata);
  const explicitVision = readExplicitBoolean(metadata, [
    "vision",
    "supports_vision",
    "attachment",
  ]);

  return {
    capabilities: {
      reasoning:
        readExplicitBoolean(metadata, ["reasoning", "supports_reasoning"]) ===
        true,
      tools:
        readExplicitBoolean(metadata, ["tool_call", "supports_tools"]) === true,
      visionInput: explicitVision ?? modalities.input.includes("image"),
      pdfInput: modalities.input.includes("pdf"),
      audioInput: modalities.input.includes("audio"),
      videoInput: modalities.input.includes("video"),
      imageOutput: modalities.output.includes("image"),
      audioOutput: modalities.output.includes("audio"),
      videoOutput: modalities.output.includes("video"),
      pdfOutput: modalities.output.includes("pdf"),
      structuredOutput:
        readExplicitBoolean(metadata, ["structured_output"]) === true,
      temperatureControl:
        readExplicitBoolean(metadata, ["temperature"]) === true,
      openWeights: readExplicitBoolean(metadata, ["open_weights"]) === true,
      fastMode: readExplicitBoolean(metadata, ["fast", "fast_mode"]) === true,
      interleavedReasoning:
        readExplicitBoolean(metadata, ["interleaved_reasoning"]) === true,
    },
    modalities: {
      ...modalities,
      unclassifiedInput: modalities.input.filter(
        (value) => !RECOGNIZED_MODALITIES.has(value),
      ),
      unclassifiedOutput: modalities.output.filter(
        (value) => !RECOGNIZED_MODALITIES.has(value),
      ),
    },
    limits: {
      contextWindow: readPositiveNumber(metadata, [
        "context_window",
        "max_context_tokens",
      ]),
      maxInputTokens: readPositiveNumber(metadata, ["max_input_tokens"]),
      maxOutputTokens: readPositiveNumber(metadata, [
        "max_output_tokens",
        "max_tokens",
      ]),
    },
    pricing: {
      input: readFirstValue(metadata, ["input_price_per_mtok", "input_price"]),
      output: readFirstValue(metadata, [
        "output_price_per_mtok",
        "output_price",
      ]),
      cacheRead: readFirstValue(metadata, [
        "cache_read_price_per_mtok",
        "cache_read_price",
      ]),
      cacheWrite: readFirstValue(metadata, ["cache_write_price_per_mtok"]),
    },
    reference: {
      family: readText(metadata, ["model_family", "family"]),
      knowledgeCutoff: readText(metadata, ["knowledge_cutoff"]),
      releaseDate: readText(metadata, ["release_date"]),
      status: readText(metadata, ["model_status", "status"]),
      extras: Object.entries(metadata).filter(
        ([key]) =>
          !NON_DISPLAY_METADATA_KEYS.has(key) && hasValue(metadata, key),
      ),
    },
  };
}

/**
 * Resolve the small capability/specification surface shown on model rows.
 *
 * The result contains only configured preview fields. A provider's explicit
 * `supports_vision: false` also removes a supplemental `image` input modality,
 * while preserving unrelated supplemental modalities such as PDF or audio.
 */
export function resolveModelPreviewMetadata(
  provider: ModelMetadata | undefined,
  supplemental: ModelMetadata | undefined,
): ModelMetadata {
  const merged = mergeModelMetadata(supplemental, provider);
  const preview: ModelMetadata = {};
  for (const keys of MODEL_PREVIEW_METADATA_GROUPS) {
    copyDefinedValues(preview, merged, keys);
  }
  return preview;
}
