import { validateInlineAssets } from "./input-assets.js";
import {
  additionalVideoModels,
  additionalVideoRule,
} from "./video-contracts.js";
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
    image_url: z.strictObject({
      url: z.union([url, z.string().regex(/^asset:\/\/[^\s]+$/)]),
    }),
    role: z.enum(["first_frame", "last_frame", "reference_image"]).optional(),
  }),
  z.strictObject({
    type: z.literal("video_url"),
    video_url: z.strictObject({
      url: z.union([url, z.string().regex(/^asset:\/\/[^\s]+$/)]),
    }),
    role: z.literal("reference_video"),
  }),
  z.strictObject({
    type: z.literal("audio_url"),
    audio_url: z.strictObject({
      url: z.union([url, z.string().regex(/^asset:\/\/[^\s]+$/)]),
    }),
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
  allowAdaptive = false,
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
    if (p.ratio === "adaptive" && !allowAdaptive)
      problem("Text-only video requires an explicit ratio");
  } else p.ratio ??= "adaptive";
  return { frames, refs };
}
const videoNotes = [
  "Exactly one text item is required. First/last frames cannot mix with reference media. Frames require adaptive ratio; text-only defaults to 16:9.",
  "Input URL files must meet the provider file-size, duration, codec and dimension limits; schema validation cannot guarantee remote content availability.",
];
function video(model: string) {
  const mini = model === "minimax-h3-max";
  const seed = model.startsWith("seedance");
  const v25 = model === "seedance-2.5";
  const res = seed
    ? v25
      ? ["480p", "720p", "1080p"]
      : model === "seedance-2.0"
        ? ["480p", "720p", "1080p", "4k"]
        : ["480p", "720p"]
    : mini
      ? ["480P", "768P"]
      : ["768P", "2K"];
  const schema = z.strictObject({
    content: z
      .array(item)
      .min(1)
      .max(v25 ? 51 : 16),
    resolution: z
      .enum(res as [string, ...string[]])
      .default(seed ? "720p" : "768P"),
    duration: (seed
      ? z.union([z.literal(-1), integer(4, v25 ? 30 : 15)])
      : integer(mini ? 5 : 4, 15)
    ).default(5),
    ratio: z.enum(["adaptive", ...ratios]).optional(),
    callback_url: z.string().url().optional(),
    ...(seed
      ? {
          generate_audio: z.boolean().optional(),
          priority: integer(0, 9).optional(),
          return_last_frame: z.boolean().optional(),
          service_tier: z.literal("default").optional(),
          execution_expires_after: integer(3600, 259200).optional(),
          safety_identifier: z
            .string()
            .max(64)
            .regex(/^[\x20-\x7e]*$/)
            .optional(),
          watermark: z.boolean().default(false),
          seed: integer(-1, 2147483647).optional(),
          ...(v25
            ? {
                omni_reference_task_type: z
                  .enum(["reference", "edit", "extend", "auto"])
                  .optional(),
                output_format: z.enum(["mp4", "mov"]).optional(),
              }
            : {}),
        }
      : { aigc_watermark: z.boolean().default(false) }),
  });
  return {
    schema,
    constraints: [
      ...videoNotes,
      ...(v25
        ? [
            "edit/extend require reference_video and adaptive ratio; edit requires duration:-1. Maximum references: 30 images, 10 videos, 10 audio.",
          ]
        : ["Maximum references: 9 images, 3 videos, 3 audio."]),
    ],
    check: (p: any) => {
      const { refs } = contentCheck(
        p,
        v25 ? [30, 10, 10] : [9, 3, 3],
        v25,
        !mini,
        seed,
      );
      if (
        seed &&
        p.content.some((i: any) => i.role === "last_frame") &&
        !p.content.some(
          (i: any) =>
            i.type === "image_url" && (!i.role || i.role === "first_frame"),
        )
      )
        problem("Seedance last_frame requires first_frame");
      if (
        !seed &&
        p.content.some((i: any) =>
          String(
            i.image_url?.url ?? i.video_url?.url ?? i.audio_url?.url ?? "",
          ).startsWith("asset://"),
        )
      )
        problem("MiniMax does not support asset URIs");
      if (["edit", "extend"].includes(p.omni_reference_task_type)) {
        if (!refs.some((i: any) => i.type === "video_url"))
          problem("edit/extend require reference_video");
        if (p.ratio !== "adaptive")
          problem("edit/extend require ratio:adaptive");
        if (p.omni_reference_task_type === "edit" && p.duration !== -1)
          problem("edit requires duration:-1");
      }
      if (p.omni_reference_task_type === "reference" && !refs.length)
        problem("reference task requires reference media");
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
  const pro = model === "seedream-5.0-pro";
  return {
    schema: z.strictObject({
      prompt: text.max(10000).optional(),
      ...(pro
        ? {
            layer_decomposition: z.boolean().optional(),
            background: z.enum(["opaque", "transparent"]).optional(),
          }
        : {}),
      size: z
        .union([
          z.enum(pro ? ["1K", "1.5K", "2K", "auto"] : ["2K", "3K", "4K"]),
          z.string().regex(/^\d+x\d+$/),
        ])
        .optional(),
      response_format: z.enum(["url", "b64_json"]).default("b64_json"),
      output_format: z.enum(["png", "jpeg"]).optional(),
      watermark: z.boolean().default(false),
      stream: (pro ? z.literal(false) : z.boolean()).default(false),
      image: z
        .union([
          url,
          z
            .array(url)
            .min(1)
            .max(pro ? 10 : 14),
        ])
        .optional(),
      optimize_prompt_options: z
        .strictObject({
          mode: z.enum(pro ? ["standard", "fast"] : ["standard"]),
        })
        .optional(),
      ...(!pro
        ? {
            sequential_image_generation: z
              .enum(["auto", "disabled"])
              .optional(),
            sequential_image_generation_options: z
              .strictObject({ max_images: integer(1, 15) })
              .optional(),
            tools: z
              .array(z.strictObject({ type: z.literal("web_search") }))
              .max(1)
              .optional(),
          }
        : {}),
      n: z.literal(1).optional(),
    }),
    constraints: [
      pro
        ? "Pro: 1K/1.5K/2K or 921600–4624220 pixels, aspect ratio 1/16–16, <=10 references. Layer decomposition requires one image and resolution preset or auto. Transparent background requires one alpha-channel image and PNG output."
        : "Lite: 2K/3K/4K or 3686400–16777216 pixels, aspect ratio 1/16–16. Reference count + max_images <=15. Group generation requires auto; supports streaming and web_search.",
    ],
    check: (p: any) => {
      p.size ??= p.layer_decomposition ? "auto" : "2K";
      if (!p.layer_decomposition && !p.prompt)
        problem("prompt is required for image generation");
      const inputs = Array.isArray(p.image)
        ? p.image
        : p.image
          ? [p.image]
          : [];
      if (
        p.layer_decomposition &&
        (inputs.length !== 1 || p.size.includes("x"))
      )
        problem(
          "Layer decomposition requires exactly one image and a size preset",
        );
      if (!p.layer_decomposition && p.size === "auto")
        problem("auto size requires layer_decomposition");
      if (p.background === "transparent") {
        if (inputs.length !== 1 || p.output_format === "jpeg")
          problem(
            "Transparent background requires one alpha-channel image and PNG output",
          );
        if (/^data:image\/jpe?g/i.test(inputs[0]))
          problem("JPEG inputs do not contain an alpha channel");
        p.output_format ??= "png";
      }
      if (p.size.includes("x")) {
        const [w, h] = p.size.split("x").map(Number);
        if (
          !w ||
          !h ||
          w * h < (pro ? 921600 : 3686400) ||
          w * h > (pro ? 4624220 : 16777216) ||
          w / h < 1 / 16 ||
          w / h > 16
        )
          problem("Invalid model pixel area or aspect ratio");
      }
      if (
        p.sequential_image_generation_options &&
        p.sequential_image_generation !== "auto"
      )
        problem("max_images requires sequential_image_generation:auto");
      const refs = Array.isArray(p.image) ? p.image.length : p.image ? 1 : 0;
      if (!pro && p.sequential_image_generation === "auto") {
        p.sequential_image_generation_options ??= { max_images: 15 - refs };
        if (refs + p.sequential_image_generation_options.max_images > 15)
          problem("References + max_images must not exceed 15");
      }
      if (p.n !== undefined && p.sequential_image_generation === "auto")
        problem("Use max_images for grouped generation, not n");
    },
  };
}
export const tokenDanceModels = [
  ...additionalVideoModels,
  "seedream-5.0-lite",
  "seedream-5.0-pro",
  "seedance-2.0",
  "seedance-2.0-fast",
  "seedance-2.0-mini",
  "seedance-2.5",
  "minimax-h3",
  "minimax-h3-max",
  "minimax-speech-2.8-hd",
  "minimax-speech-2.8-turbo",
  "seed-tts-2.0",
];
function rule(model: string) {
  if (additionalVideoModels.includes(model)) return additionalVideoRule(model);
  if (!tokenDanceModels.includes(model))
    return problem(`Model ${model} has no validated media contract`);
  if (model.startsWith("seedream")) return image(model);
  if (model.includes("speech-")) return speech(model);
  if (model === "seed-tts-2.0")
    return {
      schema: z.strictObject({
        req_params: z.strictObject({
          text: text.max(10000),
          speaker: text.default("zh_female_vv_uranus_bigtts"),
          audio_params: z
            .strictObject({
              format: z.enum(["mp3", "wav", "pcm", "ogg_opus"]).default("mp3"),
              sample_rate: choices([
                8000, 16000, 22050, 24000, 32000, 44100, 48000,
              ]).default(24000),
              speech_rate: integer(-50, 100).optional(),
              loudness_rate: integer(-50, 100).optional(),
            })
            .default({ format: "mp3", sample_rate: 24000 }),
        }),
      }),
      constraints: [
        "Use an existing Seed TTS speaker ID. PCM is wrapped in WAV for playback. Advanced req_params.additions fields are not yet validated: the linked upstream specification was unavailable during review; unknown fields are rejected before submission.",
      ],
      check: () => {},
    };
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
