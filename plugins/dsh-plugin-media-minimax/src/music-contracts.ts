import { z } from "zod";
export const musicModels = ["music-3.0", "music-2.6", "music-cover"];
const fail = (s: string): never => {
  throw new Error(s);
};
export function musicRule(model: string) {
  const cover = model.startsWith("music-cover");
  return {
    schema: z.strictObject({
      prompt: z.string().max(2000).optional(),
      lyrics: z
        .string()
        .max(cover ? 1000 : 3500)
        .optional(),
      stream: z.boolean().default(false),
      output_format: z.enum(["hex", "url"]).default("hex"),
      audio_setting: z
        .strictObject({
          sample_rate: z
            .union([
              z.literal(16000),
              z.literal(24000),
              z.literal(32000),
              z.literal(44100),
            ])
            .default(44100),
          bitrate: z
            .union([
              z.literal(32000),
              z.literal(64000),
              z.literal(128000),
              z.literal(256000),
            ])
            .optional(),
          format: z.enum(["mp3", "wav", "pcm"]).default("mp3"),
        })
        .default({ sample_rate: 44100, format: "mp3" }),
      aigc_watermark: z.boolean().default(false),
      ...(cover
        ? {
            audio_url: z.string().url().optional(),
            audio_base64: z
              .string()
              .regex(/^[A-Za-z0-9+/=]+$/)
              .optional(),
            cover_feature_id: z.string().min(1).optional(),
          }
        : {
            lyrics_optimizer: z.boolean().optional(),
            is_instrumental: z.boolean().optional(),
          }),
    }),
    constraints: [
      "Official notice: music API is available only to historical paid users as of 2026-08-20; free models are retired.",
      "Music cover requires exactly one audio_url, audio_base64 or cover_feature_id; references must be 6s–6min and <=50MB. cover_feature_id requires lyrics. Streaming is assembled into a complete audio artifact.",
    ],
    check: (p: any) => {
      if (p.stream && p.output_format !== "hex") fail("Streaming requires hex");
      if (p.stream && p.aigc_watermark)
        fail("Watermark requires non-streaming");
      if (p.audio_setting.format === "pcm" && p.output_format === "url")
        fail("PCM requires hex for WAV wrapping");
      if (p.is_instrumental && !p.prompt?.trim())
        fail("Instrumental music requires prompt");
      if (cover) {
        if (!p.prompt || p.prompt.length < 10 || p.prompt.length > 300)
          fail("Cover prompt must contain 10–300 characters");
        if (
          [p.audio_url, p.audio_base64, p.cover_feature_id].filter(Boolean)
            .length !== 1
        )
          fail("Cover requires exactly one reference source");
        if (p.cover_feature_id && !p.lyrics)
          fail("cover_feature_id requires lyrics");
        if (p.lyrics && p.lyrics.length < 10)
          fail("Cover lyrics require at least 10 characters");
      } else if (
        !p.is_instrumental &&
        !p.lyrics &&
        !(p.lyrics_optimizer && p.prompt?.trim())
      )
        fail(
          "Supply lyrics, instrumental mode or prompt with lyrics_optimizer",
        );
    },
  };
}
