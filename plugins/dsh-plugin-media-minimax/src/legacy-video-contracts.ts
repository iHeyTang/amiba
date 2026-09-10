import { z } from "zod";
export const legacyVideoModels = [
  "MiniMax-Hailuo-2.3",
  "MiniMax-Hailuo-2.3-Fast",
  "MiniMax-Hailuo-02",
  "T2V-01-Director",
  "T2V-01",
  "I2V-01-Director",
  "I2V-01-live",
  "I2V-01",
  "S2V-01",
];
const image = z
  .string()
  .regex(/^(https?:\/\/\S+|data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+)$/);
const fail = (s: string): never => {
  throw new Error(s);
};
export function legacyVideoRule(model: string) {
  const hailuo = model.startsWith("MiniMax-Hailuo");
  const subject = model === "S2V-01";
  return {
    schema: z.strictObject({
      prompt: z.string().max(2000).optional(),
      prompt_optimizer: z.boolean().optional(),
      callback_url: z.string().url().optional(),
      aigc_watermark: z.boolean().default(false),
      ...(subject
        ? {
            subject_reference: z
              .array(
                z.strictObject({
                  type: z.literal("character"),
                  image: z.array(image).length(1),
                }),
              )
              .length(1),
          }
        : {
            first_frame_image: image.optional(),
            last_frame_image: image.optional(),
            duration: z.union([z.literal(6), z.literal(10)]).default(6),
            resolution: z
              .enum(["512P", "720P", "768P", "1080P"])
              .default(hailuo ? "768P" : "720P"),
            ...(hailuo ? { fast_pretreatment: z.boolean().optional() } : {}),
          }),
    }),
    constraints: [
      "Hailuo 1080P supports 6 seconds only. 512P is only Hailuo-02 first-frame generation. Last-frame input only Hailuo-02. S2V requires one character image. Inputs must meet documented image size/format limits.",
    ],
    check: (p: any) => {
      if (subject) return;
      if (
        model.startsWith("T2V-") &&
        (p.first_frame_image || p.last_frame_image)
      )
        fail("Text-only model cannot accept frames");
      if (
        (model.startsWith("I2V-") || model.endsWith("-Fast")) &&
        !p.first_frame_image
      )
        fail("This model requires first_frame_image");
      if (p.last_frame_image && model !== "MiniMax-Hailuo-02")
        fail("last_frame_image requires MiniMax-Hailuo-02");
      if (!p.first_frame_image && !p.last_frame_image && !p.prompt?.trim())
        fail("Text-to-video requires prompt");
      if (!hailuo && (p.duration !== 6 || p.resolution !== "720P"))
        fail("Legacy video supports 6s / 720P only");
      if (hailuo && p.resolution === "720P") fail("Hailuo uses 768P or 1080P");
      if (p.resolution === "1080P" && p.duration !== 6)
        fail("1080P requires duration:6");
      if (
        p.resolution === "512P" &&
        (model !== "MiniMax-Hailuo-02" ||
          !p.first_frame_image ||
          p.last_frame_image)
      )
        fail("512P requires Hailuo-02 first-frame mode");
      if (p.last_frame_image && p.fast_pretreatment)
        fail("fast_pretreatment is not available in last-frame mode");
    },
  };
}
