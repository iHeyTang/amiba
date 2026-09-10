import { z } from "zod";
const url = z
  .string()
  .regex(/^(https?:\/\/\S+|data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+)$/);
const int = (a: number, b: number) => z.number().int().min(a).max(b);
const text = z.string().trim().min(1);
const fail = (s: string): never => {
  throw new Error(s);
};
const ratios = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const;
const media = z.strictObject({
  type: z.enum([
    "first_frame",
    "last_frame",
    "reference_image",
    "reference_video",
    "reference_audio",
    "file",
    "link",
    "video",
  ]),
  url,
});
export const additionalVideoModels = [
  "kling-3.0",
  "kling-3.0-turbo",
  "kling-3.0-omni",
  "wan3.0-video",
  "wan3.0-video-prime",
  "happyhorse-1.0-t2v",
  "happyhorse-1.0-i2v",
  "happyhorse-1.0-r2v",
  "happyhorse-1.0-video-edit",
  "happyhorse-1.1-t2v",
  "happyhorse-1.1-i2v",
  "happyhorse-1.1-r2v",
];
export function additionalVideoRule(model: string) {
  if (model.startsWith("kling-")) return kling(model);
  const wan = model.startsWith("wan3.");
  const edit = model.endsWith("video-edit");
  return {
    schema: z.strictObject({
      input: z.strictObject({
        prompt: text.max(wan ? 5000 : 5000),
        media: z.array(media).optional(),
        ...(!wan
          ? {
              img_url: url.optional(),
              ref_images_url: z.array(url).min(1).max(9).optional(),
              video_url: url.optional(),
            }
          : {}),
      }),
      parameters: z
        .strictObject({
          resolution: z.enum(["480P", "720P", "1080P"]).optional(),
          ratio: z
            .enum(
              wan
                ? ["adaptive", ...ratios]
                : [...ratios, "4:5", "5:4", "9:21", "21:9"],
            )
            .optional(),
          duration: (wan
            ? z.union([z.literal(-1), int(2, 30)])
            : int(3, 15)
          ).optional(),
          seed: int(wan ? -1 : 0, 2147483647).optional(),
          watermark: z.boolean().default(false),
          ...(edit
            ? { audio_setting: z.enum(["auto", "origin"]).optional() }
            : {}),
          ...(wan
            ? {
                audio: z.boolean().optional(),
                prompt_extend: z.boolean().optional(),
              }
            : {
                size: z
                  .string()
                  .regex(/^\d+\*\d+$/)
                  .optional(),
              }),
        })
        .default({ watermark: false }),
    }),
    constraints: [
      wan
        ? "Reference limits: 10 images, 5 videos, 5 audio; each video/audio 1–15 seconds, total per type <=15 seconds. Input+output video duration <=30 seconds. Frames and references are exclusive. file/link requires prompt_extend:true."
        : "HappyHorse modes are separate models. 3–15 seconds; references maximum 9 images. Legacy img_url/ref_images_url and native media must not be mixed. Remote asset encoding and dimensions require upstream validation.",
    ],
    check: (p: any) => {
      if (
        !wan &&
        Array.from(p.input.prompt as string).reduce(
          (n, c) => n + (/[\u3400-\u9fff]/.test(c) ? 2 : 1),
          0,
        ) > 5000
      )
        fail("HappyHorse prompt exceeds the documented character limit");
      const c: any[] = p.input.media ?? [];
      if (wan) {
        if (c.some((x) => x.type === "video"))
          fail("Wan reference video uses reference_video");
        const frames = c.filter((x) =>
          ["first_frame", "last_frame"].includes(x.type),
        );
        if (frames.length && frames.length !== c.length)
          fail("Frames cannot mix with reference media");
        for (const [type, max] of Object.entries({
          first_frame: 1,
          last_frame: 1,
          reference_image: 10,
          reference_video: 5,
          reference_audio: 5,
          file: 1,
          link: 1,
        }))
          if (c.filter((x) => x.type === type).length > max)
            fail(`Too many ${type}`);
        if (
          c.some((x) => x.type === "last_frame") &&
          !c.some((x) => x.type === "first_frame")
        )
          fail("last_frame requires first_frame");
        const external = c.filter((x) => ["file", "link"].includes(x.type));
        if (external.length > 1) fail("file and link are mutually exclusive");
        if (external.length && p.parameters.prompt_extend !== true)
          fail("file/link requires prompt_extend:true");
        if (
          frames.length &&
          p.parameters.ratio &&
          p.parameters.ratio !== "adaptive"
        )
          fail("Frame inputs require adaptive ratio");
        p.parameters.ratio ??= frames.length ? "adaptive" : "16:9";
      } else {
        if (
          c.length &&
          (p.input.img_url || p.input.ref_images_url || p.input.video_url)
        )
          fail("Use media or legacy input fields, not both");
        if (
          model.endsWith("-t2v") &&
          (c.length ||
            p.input.img_url ||
            p.input.ref_images_url ||
            p.input.video_url)
        )
          fail("Text-to-video model cannot accept reference inputs");
        if (
          model.endsWith("-i2v") &&
          !(p.input.img_url || (c.length === 1 && c[0].type === "first_frame"))
        )
          fail("Image-to-video requires one first frame");
        if (
          model.endsWith("-r2v") &&
          !(
            p.input.ref_images_url ||
            (c.length > 0 &&
              c.length <= 9 &&
              c.every((x) => x.type === "reference_image"))
          )
        )
          fail("Reference-to-video requires 1–9 reference images");
        if (edit) {
          if (
            !(
              p.input.video_url ||
              (c.filter((x) => x.type === "video").length === 1 &&
                c.filter((x) => x.type === "reference_image").length <= 5 &&
                c.every((x) => ["video", "reference_image"].includes(x.type)))
            )
          )
            fail(
              "Video editing requires one video and at most 5 reference images",
            );
          if (p.parameters.resolution === "480P" || p.parameters.ratio)
            fail(
              "Video editing supports 720P/1080P and preserves source ratio",
            );
          if (p.input.ref_images_url?.length > 5)
            fail("Video editing supports at most 5 reference images");
        }
        if (
          model.endsWith("-i2v") &&
          (p.input.ref_images_url || p.input.video_url || p.parameters.ratio)
        )
          fail("Incompatible image-to-video fields");
        if (model.endsWith("-r2v") && (p.input.img_url || p.input.video_url))
          fail("Incompatible reference-to-video fields");
        if (
          p.parameters.size &&
          (p.parameters.resolution || p.parameters.ratio)
        )
          fail("size cannot combine with resolution or ratio");
      }
      if (!edit) p.parameters.duration ??= 5;
      if (!p.parameters.size) p.parameters.resolution ??= "720P";
    },
  };
}
function kling(model: string) {
  const omni = model === "kling-3.0-omni";
  const frame = z.strictObject({
    type: z.enum(
      omni
        ? [
            "first_frame",
            "last_frame",
            "refer_image",
            "base_video",
            "feature_video",
          ]
        : ["first_frame", "last_frame"],
    ),
    url,
    id: text.optional(),
  });
  return {
    schema: z.strictObject({
      prompt: omni ? z.never().optional() : text.optional(),
      contents: z
        .array(
          z.union([
            z.strictObject({ type: z.literal("prompt"), text }),
            frame,
            ...(omni
              ? [
                  z.strictObject({
                    type: z.literal("element"),
                    element_id: z.number().int().positive(),
                    id: text,
                  }),
                ]
              : []),
          ]),
        )
        .min(1)
        .optional(),
      settings: z
        .strictObject({
          resolution: z
            .enum(omni ? ["720p", "1080p", "4k"] : ["720p", "1080p"])
            .default("720p"),
          duration: int(3, 15).optional(),
          aspect_ratio: z.enum(["16:9", "9:16", "1:1"]).optional(),
          ...(omni
            ? {
                audio: z.enum(["off", "original"]).optional(),
                multi_shot: z.boolean().optional(),
              }
            : {}),
        })
        .default({ resolution: "720p" }),
      options: z
        .strictObject({
          watermark_info: z.strictObject({ enabled: z.boolean().default(false) }).default({ enabled: false }),
        })
        .default({ watermark_info: { enabled: false } }),
    }),
    constraints: [
      "Fields follow the TokenDance protocol reference; additional Kling upstream fields were not verifiable and remain rejected. Use native contents/settings fields, not legacy top-level mode/duration/image. Turbo does not support last_frame. base_video editing follows input duration; original audio requires base_video.",
    ],
    check: (p: any) => {
      const c: any[] = p.contents ?? [];
      if (!!p.prompt === !!p.contents)
        fail("Supply prompt for text2video or contents for image/omni video");
      if (c.length && c.filter((x) => x.type === "prompt").length !== 1)
        fail("contents requires exactly one prompt");
      if (!omni && c.length && !c.some((x) => x.type === "first_frame"))
        fail("Image-to-video requires first_frame");
      for (const type of [
        "first_frame",
        "last_frame",
        "base_video",
        "feature_video",
      ])
        if (c.filter((x) => x.type === type).length > 1)
          fail(`At most one ${type}`);
      if (model === "kling-3.0-turbo" && c.some((x) => x.type === "last_frame"))
        fail("Turbo does not support last_frame");
      const ids = c.map((x) => x.id).filter(Boolean);
      if (new Set(ids).size !== ids.length)
        fail("Reference IDs must be unique");
      if (c.some((x) => x.type === "base_video")) {
        if (p.settings.duration !== undefined)
          fail("Editing follows source duration; omit duration");
      } else {
        if (p.settings.audio === "original")
          fail("original audio requires base_video");
        p.settings.duration ??= 5;
      }
    },
  };
}
