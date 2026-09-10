import { validateInlineAssets } from "./input-assets.js";
import {
  legacyVideoModels,
  legacyVideoRule,
} from "./legacy-video-contracts.js";
import { musicModels, musicRule } from "./music-contracts.js";
// Provider-owned rules. Update and version these alongside this provider’s transport.
import { z } from "zod";
export interface ModelContract {
  version: string;
  schema: Record<string, unknown>;
  constraints: string[];
}
const text = z.string().trim().min(1);
const url = z
  .string()
  .regex(
    /^(https:\/\/[^\s]+|data:(image|video|audio)\/[\w.+-]+;base64,[A-Za-z0-9+/=]+)$/,
  )
  .describe(
    "Public HTTPS URL or media base64 data URL; remote asset format, dimensions and availability remain provider-validated.",
  );
const integer = (min: number, max: number) =>
  z.number().int().min(min).max(max);
const choices = (values: number[]) =>
  z.union(
    values.map((v) => z.literal(v)) as [
      z.ZodLiteral<number>,
      z.ZodLiteral<number>,
      ...z.ZodLiteral<number>[],
    ],
  );
const ratios = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;
const item = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("text"), text: text.max(10000) }),
  z.strictObject({
    type: z.literal("image_url"),
    image_url: z.strictObject({ url }),
    role: z.enum(["first_frame", "last_frame", "reference_image"]).optional(),
  }),
  z.strictObject({
    type: z.literal("video_url"),
    video_url: z.strictObject({ url }),
    role: z.literal("reference_video"),
  }),
  z.strictObject({
    type: z.literal("audio_url"),
    audio_url: z.strictObject({ url }),
    role: z.literal("reference_audio"),
  }),
]);
function problem(message: string): never {
  throw new Error(message);
}
function contentCheck(
  p: any,
  counts: [number, number, number],
  audioOnly: boolean,
  references = true,
) {
  const c: any[] = p.content;
  if (c.filter((i) => i.type === "text").length !== 1)
    problem("content must contain exactly one non-empty text item");
  const media = c.filter((i) => i.type !== "text");
  const frames = media.filter(
    (i) => !i.role || ["first_frame", "last_frame"].includes(i.role),
  );
  const refs = media.filter((i) => i.role?.startsWith("reference_"));
  if (frames.length && refs.length)
    problem("First/last frames and reference media cannot be mixed");
  for (const role of ["first_frame", "last_frame"])
    if (frames.filter((i) => (i.role ?? "first_frame") === role).length > 1)
      problem(`At most one ${role}`);
  if (!references && refs.length)
    problem("This model does not support reference media");
  ["image_url", "video_url", "audio_url"].forEach((type, i) => {
    if (refs.filter((r) => r.type === type).length > counts[i]!)
      problem(`Too many ${type} references (maximum ${counts[i]})`);
  });
  if (!audioOnly && refs.length && !refs.some((i) => i.type !== "audio_url"))
    problem("Audio references require an image or video reference");
  if (frames.length) {
    if (p.ratio && p.ratio !== "adaptive")
      problem(
        "Frame inputs require ratio:adaptive; fixed ratios would be ignored",
      );
    p.ratio = "adaptive";
  } else if (!media.length) {
    p.ratio ??= "16:9";
    if (p.ratio === "adaptive")
      problem("Text-only video requires an explicit ratio");
  } else p.ratio ??= "adaptive";
  return { frames, refs };
}
const videoNotes = [
  "Exactly one text item is required. First/last frames cannot mix with reference media. Frames require adaptive ratio; text-only defaults to 16:9.",
  "Input URL files must meet the provider file-size, duration, codec and dimension limits; schema validation cannot guarantee remote content availability.",
];
function video(model: string) {
  const mini = model === "MiniMax-H3-Max";
  return {
    schema: z.strictObject({
      content: z.array(item).min(1).max(16),
      resolution: z
        .enum(mini ? ["480P", "768P"] : ["768P", "2K"])
        .default("768P"),
      duration: integer(mini ? 5 : 4, 15).default(5),
      ratio: z.enum(["adaptive", ...ratios]).optional(),
      aigc_watermark: z.boolean().default(false),
      callback_url: z.string().url().optional(),
    }),
    constraints: [
      ...videoNotes,
      "Maximum references: 9 images, 3 videos, 3 audio.",
    ],
    check: (p: any) => {
      contentCheck(p, [9, 3, 3], false, !mini);
    },
  };
}
function speech(model: string) {
  const schema = z.strictObject({
    text: text.max(9999),
    stream: z.boolean().default(false),
    stream_options: z
      .strictObject({ exclude_aggregated_audio: z.boolean().optional() })
      .optional(),
    output_format: z.enum(["hex", "url"]).default("hex"),
    voice_setting: z
      .strictObject({
        voice_id: z.string().trim().optional(),
        speed: z.number().min(0.5).max(2).default(1),
        vol: z.number().gt(0).max(10).default(1),
        pitch: integer(-12, 12).default(0),
        emotion: z
          .enum([
            "happy",
            "sad",
            "angry",
            "fearful",
            "disgusted",
            "surprised",
            "calm",
            "fluent",
            "whisper",
          ])
          .optional(),
        text_normalization: z.boolean().optional(),
        latex_read: z.boolean().optional(),
      })
      .default({ voice_id: "male-qn-qingse", speed: 1, vol: 1, pitch: 0 }),
    audio_setting: z
      .strictObject({
        format: z
          .enum(["mp3", "wav", "flac", "pcm", "pcmu_raw", "pcmu_wav", "opus"])
          .default("mp3"),
        force_cbr: z.boolean().optional(),
        sample_rate: choices([8000, 16000, 22050, 24000, 32000, 44100]).default(
          32000,
        ),
        bitrate: choices([32000, 64000, 128000, 256000]).optional(),
        channel: choices([1, 2]).default(1),
      })
      .default({ format: "mp3", sample_rate: 32000, channel: 1 }),
    subtitle_enable: z.boolean().optional(),
    subtitle_type: z.enum(["sentence", "word", "word_streaming"]).optional(),
    timbre_weights: z
      .array(z.strictObject({ voice_id: text, weight: integer(1, 100) }))
      .min(1)
      .max(4)
      .optional(),
    voice_modify: z
      .strictObject({
        pitch: integer(-100, 100).optional(),
        intensity: integer(-100, 100).optional(),
        timbre: integer(-100, 100).optional(),
        sound_effects: z
          .enum([
            "spacious_echo",
            "auditorium_echo",
            "lofi_telephone",
            "robotic",
          ])
          .optional(),
      })
      .optional(),
    pronunciation_dict: z
      .strictObject({ tone: z.array(text).max(100) })
      .optional(),
    language_boost: z
      .enum([
        "Chinese",
        "Chinese,Yue",
        "English",
        "Arabic",
        "Russian",
        "Spanish",
        "French",
        "Portuguese",
        "German",
        "Turkish",
        "Dutch",
        "Ukrainian",
        "Vietnamese",
        "Indonesian",
        "Japanese",
        "Italian",
        "Korean",
        "Thai",
        "Polish",
        "Romanian",
        "Greek",
        "Czech",
        "Finnish",
        "Hindi",
        "Bulgarian",
        "Danish",
        "Hebrew",
        "Malay",
        "Persian",
        "Slovak",
        "Swedish",
        "Croatian",
        "Filipino",
        "Hungarian",
        "Norwegian",
        "Slovenian",
        "Catalan",
        "Nynorsk",
        "Tamil",
        "Afrikaans",
        "auto",
      ])
      .optional(),
    aigc_watermark: z.boolean().default(false),
  });
  return {
    schema,
    constraints: [
      "Use existing provider voice IDs. Up to 4 mixed voices; clear voice_setting.voice_id when mixing. Streaming chunks are assembled into a complete artifact. PCM is wrapped in WAV for playback. Subtitles are delivered as JSON companion files.",
    ],
    check: (p: any) => {
      if (p.timbre_weights) {
        if (
          p.voice_setting.voice_id &&
          p.voice_setting.voice_id !== "male-qn-qingse"
        )
          problem("Mixed voices require empty voice_setting.voice_id");
        p.voice_setting.voice_id = "";
      } else p.voice_setting.voice_id ||= "male-qn-qingse";
      if (
        ["pcm", "pcmu_raw"].includes(p.audio_setting.format) &&
        p.output_format === "url"
      )
        problem("Raw PCM requires hex output for WAV wrapping");
      if (p.subtitle_type && !p.subtitle_enable)
        problem("subtitle_type requires subtitle_enable:true");
      if (p.subtitle_type === "word_streaming" && !p.stream)
        problem("word_streaming requires stream:true");
      if (p.stream && p.output_format !== "hex")
        problem("Streaming requires hex output");
      if (!p.stream && p.stream_options)
        problem("stream_options requires stream:true");
      if (
        p.audio_setting.force_cbr &&
        (!p.stream || p.audio_setting.format !== "mp3")
      )
        problem("force_cbr requires streaming mp3");
      if (
        p.voice_modify &&
        !(p.stream ? ["mp3"] : ["mp3", "wav", "flac"]).includes(
          p.audio_setting.format,
        )
      )
        problem("Unsupported voice_modify audio format");
      if (
        p.audio_setting.format.startsWith("pcmu") &&
        p.audio_setting.sample_rate !== 8000
      )
        problem("G.711 requires sample_rate:8000");
      if (p.stream && p.aigc_watermark)
        problem("aigc_watermark requires non-streaming audio");
      if (
        p.voice_setting.emotion === "whisper" &&
        !model.includes("speech-2.6-")
      )
        problem("whisper emotion requires speech-2.6");
      if (
        p.voice_setting.emotion === "fluent" &&
        !model.includes("speech-2.6-")
      )
        problem("fluent emotion is not enabled for this model");
      if (
        /speech-0[12]-/.test(model) &&
        ["Persian", "Filipino", "Tamil"].includes(p.language_boost)
      )
        problem("This model does not support the selected language");
      if (
        p.voice_setting.latex_read &&
        p.language_boost &&
        p.language_boost !== "Chinese"
      )
        problem("latex_read requires Chinese language");
      if (
        p.audio_setting.format !== "mp3" &&
        p.audio_setting.bitrate !== undefined
      )
        problem("bitrate applies only to mp3");
    },
  };
}
function image(model: string) {
  const live = model === "image-01-live";
  return {
    schema: z.strictObject({
      prompt: text.max(1500),
      response_format: z.enum(["base64", "url"]).default("base64"),
      subject_reference: z
        .array(
          z.strictObject({ type: z.literal("character"), image_file: url }),
        )
        .min(1)
        .max(1)
        .optional(),
      aspect_ratio: z
        .enum(
          live
            ? [...ratios.filter((x) => x !== "21:9"), "3:2", "2:3"]
            : [...ratios, "3:2", "2:3"],
        )
        .optional(),
      width: integer(512, 2048).multipleOf(8).optional(),
      height: integer(512, 2048).multipleOf(8).optional(),
      n: integer(1, 9).default(1),
      seed: z.number().int().safe().optional(),
      prompt_optimizer: z.boolean().optional(),
      aigc_watermark: z.boolean().default(false),
      style: z
        .strictObject({
          style_type: z.enum(["漫画", "元气", "中世纪", "水彩"]),
          style_weight: z.number().gt(0).max(1).optional(),
        })
        .optional(),
    }),
    constraints: [
      "width and height must be provided together; cannot combine with aspect_ratio. Custom sizes only image-01; style only image-01-live.",
    ],
    check: (p: any) => {
      if ((p.width === undefined) !== (p.height === undefined))
        problem("width and height must be supplied together");
      if (p.width !== undefined && (live || p.aspect_ratio !== undefined))
        problem(
          "Custom dimensions require image-01 and cannot mix with aspect_ratio",
        );
      if (p.style && !live) problem("style requires image-01-live");
      if (!p.width) p.aspect_ratio ??= "1:1";
    },
  };
}
export const minimaxModels = [
  ...legacyVideoModels,
  ...musicModels,
  "MiniMax-H3",
  "MiniMax-H3-Max",
  "image-01",
  "image-01-live",
  "speech-2.8-hd",
  "speech-2.8-turbo",
  "speech-2.6-hd",
  "speech-2.6-turbo",
  "speech-02-hd",
  "speech-02-turbo",
  "speech-01-hd",
  "speech-01-turbo",
];
function rule(model: string) {
  if (legacyVideoModels.includes(model)) return legacyVideoRule(model);
  if (musicModels.includes(model)) return musicRule(model);
  if (!minimaxModels.includes(model))
    return problem(`Model ${model} has no validated media contract`);
  if (model.startsWith("image-")) return image(model);
  if (model.includes("speech-")) return speech(model);
  return video(model);
}
export function contractFor(model: string): ModelContract {
  const r = rule(model);
  return {
    version: "2026-09-09.2",
    schema: z.toJSONSchema(r.schema) as Record<string, unknown>,
    constraints: r.constraints,
  };
}
export function normalizeParameters(
  model: string,
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  const r = rule(model);
  const copy = { ...parameters };
  if (copy.model !== undefined && copy.model !== model)
    problem("parameters.model conflicts with selected model");
  delete copy.model;
  if (
    copy.timbre_weights &&
    (copy.voice_setting as { voice_id?: string } | undefined)?.voice_id
  )
    problem("Mixed voices require empty voice_setting.voice_id");
  const parsed = r.schema.safeParse(copy);
  if (!parsed.success)
    problem(
      parsed.error.issues
        .map((i) => `${i.path.join(".") || "parameters"}: ${i.message}`)
        .join("; "),
    );
  const p = parsed.data;
  r.check(p);
  validateInlineAssets(model, p);
  return p;
}
