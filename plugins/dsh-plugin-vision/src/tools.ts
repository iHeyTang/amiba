import { readFile } from "node:fs/promises";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { registerToolSource } from "@amiba/dsh-plugin-catalog";
import type { Context } from "@deepseek-ai/cordis";
import type { ImageMediaType } from "@deepseek-ai/dsh-attachment";
import type { VisionCatalog } from "./catalog.js";

const source = {
  kind: "dsh-plugin",
  distribution: "builtin",
  id: "amiba-vision",
  name: "Amiba Vision",
  packageName: "@amiba/dsh-plugin-vision",
  loadMode: "plugin",
  executionTarget: "dsh-runtime",
  dynamic: false,
} as const;

/** The provider-side ceiling for one request image; larger files are refused here. */
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

const DEFAULT_PROMPT =
  "Describe this image completely: subjects, text, layout, numbers, and anything a reader would need to act on it.";

/**
 * The format comes from the bytes, never from the file name — the same rule the
 * providers apply, so a mistyped extension cannot select the wrong decoder.
 */
export function imageMediaTypeOf(data: Uint8Array): ImageMediaType | undefined {
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  )
    return "image/png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
    return "image/jpeg";
  if (
    data.length >= 12 &&
    String.fromCharCode(...data.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...data.subarray(8, 12)) === "WEBP"
  )
    return "image/webp";
  if (data.length >= 6 && String.fromCharCode(...data.subarray(0, 3)) === "GIF")
    return "image/gif";
  return undefined;
}

export function registerVisionTools(ctx: Context, catalog: VisionCatalog) {
  ctx.tools.register(
    defineTool({
      name: "vision_recognize",
      description:
        "Read one image with the assigned vision model and return its text. Use this whenever you cannot accept an image yourself: an attached image is reported to a text-only model as a read-only normalized path, and that path is the argument this tool wants. The image never enters your own context.",
      parameters: {
        image: {
          type: "string",
          required: true,
          description:
            "Path to an image file (PNG, JPEG, WebP or GIF) readable in this session — typically the read-only normalized path reported alongside an omitted attachment.",
        },
        prompt: {
          type: "string",
          description:
            "What to extract from the image. Defaults to a complete description.",
        },
        provider: {
          type: "string",
          description:
            "Optional override of the assigned vision provider; requires model.",
        },
        model: {
          type: "string",
          description:
            "Optional override of the assigned vision model; requires provider.",
        },
      },
      output: {
        schema: {
          type: "object" as const,
          additionalProperties: false as const,
          properties: {
            text: { type: "string" as const, required: true as const },
            provider: { type: "string" as const, required: true as const },
            model: { type: "string" as const, required: true as const },
            imagePath: { type: "string" as const, required: true as const },
            truncated: { type: "boolean" as const, required: true as const },
          },
        },
        render: (_args: unknown, value: { text: string }) => [
          { type: "text" as const, text: value.text },
        ],
      },
      isConcurrencySafe: () => true,
      execute: async (args, _exec) => {
        if ((args.provider === undefined) !== (args.model === undefined))
          throw new Error("Pass provider and model together, or neither");
        let data: Buffer;
        try {
          data = await readFile(args.image);
        } catch {
          throw new Error(`Cannot read the image at "${args.image}"`);
        }
        if (data.length === 0) throw new Error("The image file is empty");
        if (data.length > MAX_IMAGE_BYTES)
          throw new Error("The image exceeds the 32 MiB vision limit");
        const mediaType = imageMediaTypeOf(data);
        if (mediaType === undefined)
          throw new Error(
            "Unsupported image format: PNG, JPEG, WebP and GIF are accepted, detected from the file content",
          );
        const target =
          args.provider !== undefined && args.model !== undefined
            ? await catalog.validate({
                provider: args.provider,
                model: args.model,
              })
            : await catalog.resolve();
        if (target === undefined)
          throw new Error(
            "No vision model is assigned and no configured model declares image input. Assign one in Settings → Model services → Model assignment → Vision.",
          );
        const attachment = await ctx.attachments.saveImage({ data, mediaType });
        const message = createUserMessage({
          content: [
            { type: "image", attachment },
            { type: "text", text: args.prompt ?? DEFAULT_PROMPT },
          ],
          source: { kind: "user" },
        });
        let text = "";
        for await (const chunk of ctx.llm.stream({
          provider: target.provider,
          model: target.model,
          messages: [message],
        })) {
          if (chunk.type === "text-delta") text += chunk.text;
        }
        const trimmed = text.trim();
        if (trimmed === "")
          throw new Error(
            `The vision model "${target.model}" returned no text`,
          );
        return {
          text: trimmed,
          provider: target.provider,
          model: target.model,
          imagePath: args.image,
          truncated: false,
        };
      },
    }),
  );
  registerToolSource(ctx, "vision_recognize", source);
  ctx.systemPrompt.context({
    name: "amiba:vision",
    order: 57,
    text: "When an image arrives that your own model cannot accept, DSH replaces its bytes with a placeholder naming a read-only normalized path. Call vision_recognize with that path (and a prompt describing what you need) to read the image through the assigned vision model; the image never enters your own context. Vision is optional: if the tool reports that no vision model is assigned, tell the user to assign one in Settings → Model services → Model assignment → Vision, and never guess at an image's contents.",
  });
}
