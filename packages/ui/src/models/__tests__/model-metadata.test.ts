import { describe, expect, it } from "vitest";

import {
  mergeModelMetadata,
  normalizeModelMetadata,
  resolveModelPreviewMetadata,
} from "../model-metadata";

describe("model metadata resolution", () => {
  it("uses the preview allowlist regardless of source", () => {
    const preview = resolveModelPreviewMetadata(
      {
        fast_mode: true,
        temperature: true,
      },
      {
        context_window: 1_000_000,
        input_price_per_mtok: 1.25,
        model_family: "example-v2",
        open_weights: true,
        reasoning: true,
        release_date: "2026-07-01",
        structured_output: true,
        tool_call: true,
        interleaved_reasoning: true,
        vision: true,
      },
    );

    expect(preview).toEqual({
      reasoning: true,
      tool_call: true,
      vision: true,
      context_window: 1_000_000,
    });
  });

  it("keeps contextual capabilities in merged details with provider precedence", () => {
    expect(
      mergeModelMetadata(
        {
          fast_mode: true,
          structured_output: true,
        },
        {
          fast: false,
          temperature: true,
        },
      ),
    ).toMatchObject({
      fast: false,
      structured_output: true,
      temperature: true,
    });
  });

  it("lets provider aliases and explicit false values override supplemental data", () => {
    const supplemental = {
      context_window: 1_000_000,
      input_modalities: ["text", "image", "pdf"],
      reasoning: true,
      tool_call: true,
      vision: true,
    };
    const provider = {
      max_context_tokens: 128_000,
      supports_reasoning: false,
      supports_tools: false,
      supports_vision: false,
    };

    expect(resolveModelPreviewMetadata(provider, supplemental)).toEqual({
      supports_reasoning: false,
      supports_tools: false,
      supports_vision: false,
      input_modalities: ["text", "pdf"],
      max_context_tokens: 128_000,
    });
    expect(mergeModelMetadata(supplemental, provider)).toMatchObject({
      supports_reasoning: false,
      supports_tools: false,
      supports_vision: false,
      input_modalities: ["text", "pdf"],
      max_context_tokens: 128_000,
    });

    const directional = resolveModelPreviewMetadata(
      { supports_vision: false },
      { modality: "text+image+pdf->text+image" },
    );
    expect(directional).toEqual({
      supports_vision: false,
      modality: "text+pdf->text+image",
    });
    expect(normalizeModelMetadata(directional).capabilities).toMatchObject({
      visionInput: false,
      pdfInput: true,
      imageOutput: true,
    });
  });

  it("normalizes aliases and directional modalities into unique semantics", () => {
    const normalized = normalizeModelMetadata({
      supports_reasoning: true,
      supports_tools: true,
      supports_vision: true,
      input_modalities: [
        "text",
        "image",
        "images",
        "pdf",
        "application/pdf",
        "audio",
        "video",
        "point-cloud",
      ],
      output_modalities: ["text", "image", "audio", "video", "mesh"],
      modality: "text+image->text+audio",
      max_context_tokens: "128000",
      max_tokens: 8192,
      parameters: "120B",
    });

    expect(normalized.capabilities).toMatchObject({
      reasoning: true,
      tools: true,
      visionInput: true,
      pdfInput: true,
      audioInput: true,
      videoInput: true,
      imageOutput: true,
      audioOutput: true,
      videoOutput: true,
    });
    expect(normalized.modalities.input).toEqual([
      "text",
      "image",
      "pdf",
      "audio",
      "video",
      "point-cloud",
    ]);
    expect(normalized.modalities.output).toEqual([
      "text",
      "image",
      "audio",
      "video",
      "mesh",
    ]);
    expect(normalized.modalities.unclassifiedInput).toEqual(["point-cloud"]);
    expect(normalized.modalities.unclassifiedOutput).toEqual(["mesh"]);
    expect(normalized.limits).toMatchObject({
      contextWindow: 128_000,
      maxOutputTokens: 8192,
    });
    expect(normalized.reference.extras).toEqual([["parameters", "120B"]]);
  });
});
