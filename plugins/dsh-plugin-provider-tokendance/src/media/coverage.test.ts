import { expect, it, vi } from "vitest";
import {
  normalizeParameters,
  tokenDanceModels,
  contractFor,
} from "./model-contracts.js";
import { TokenDanceMediaProvider } from "./adapter.js";
const signal = new AbortController().signal;
const png = "https://example.com/cat.png";
it.each(tokenDanceModels)(
  "accepts a basic valid request and exposes its fields: %s",
  (model) => {
    const p = model.startsWith("seedream")
      ? { prompt: "cat" }
      : model.startsWith("seedance") || model.startsWith("minimax-h3")
        ? { content: [{ type: "text", text: "cat" }] }
        : model.startsWith("minimax-speech")
          ? { text: "hello" }
          : model === "seed-tts-2.0"
            ? { req_params: { text: "hello" } }
            : model.startsWith("kling")
              ? model.endsWith("omni")
                ? { contents: [{ type: "prompt", text: "cat" }] }
                : { prompt: "cat" }
              : {
                  input: {
                    prompt: "cat",
                    ...(model.endsWith("-i2v")
                      ? { img_url: png }
                      : model.endsWith("-r2v")
                        ? { ref_images_url: [png] }
                        : model.endsWith("-edit")
                          ? { video_url: "https://example.com/v.mp4" }
                          : {}),
                  },
                };
    expect(normalizeParameters(model, p)).toBeTruthy();
    expect(contractFor(model).schema).toBeTruthy();
  },
);
it("validates Seedream sizes, groups, reference budgets and model differences", () => {
  expect(
    normalizeParameters("seedream-5.0-lite", {
      prompt: "cat",
      size: "4K",
      stream: true,
      sequential_image_generation: "auto",
      sequential_image_generation_options: { max_images: 4 },
      tools: [{ type: "web_search" }],
    }),
  ).toMatchObject({ size: "4K", stream: true });
  expect(
    normalizeParameters("seedream-5.0-pro", {
      prompt: "cat",
      size: "1024x1024",
      optimize_prompt_options: { mode: "fast" },
    }),
  ).toMatchObject({ size: "1024x1024" });
  for (const p of [
    { size: "1024x1024" },
    {
      image: Array(14).fill(png),
      sequential_image_generation: "auto",
      sequential_image_generation_options: { max_images: 2 },
    },
    { optimize_prompt_options: { mode: "fast" } },
  ])
    expect(() =>
      normalizeParameters("seedream-5.0-lite", { prompt: "cat", ...p }),
    ).toThrow();
  expect(() =>
    normalizeParameters("seedream-5.0-pro", { prompt: "cat", stream: true }),
  ).toThrow();
});
it.each([
  [
    "kling-3.0-turbo",
    {
      contents: [
        { type: "prompt", text: "cat" },
        { type: "first_frame", url: png },
        { type: "last_frame", url: png },
      ],
    },
  ],
  [
    "kling-3.0-omni",
    {
      contents: [
        { type: "prompt", text: "cat" },
        { type: "base_video", url: "https://example.com/a.mp4" },
      ],
      settings: { duration: 5 },
    },
  ],
  [
    "wan3.0-video",
    {
      input: {
        prompt: "cat",
        media: [
          { type: "file", url: png },
          { type: "link", url: png },
        ],
      },
      parameters: { prompt_extend: true },
    },
  ],
  [
    "wan3.0-video",
    {
      input: {
        prompt: "cat",
        media: [
          { type: "first_frame", url: png },
          { type: "reference_image", url: png },
        ],
      },
    },
  ],
  ["happyhorse-1.1-i2v", { input: { prompt: "cat" } }],
] as const)("rejects incompatible mode inputs for %s", (m, p) =>
  expect(() => normalizeParameters(m, p)).toThrow(),
);
it("retains partial stream images without another paid submission", async () => {
  const http = vi.fn(
    async () =>
      new Response(
        'data: {"type":"image_generation.partial_succeeded","b64_json":"AQID"}\n\ndata: {"type":"image_generation.partial_failed"}\n\n',
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  const provider = new TokenDanceMediaProvider(
    async () => ({ baseURL: "https://example.com/gateway", apiKey: "fixture" }),
    http,
  );
  const result = await provider.generate(
    {
      model: "seedream-5.0-lite",
      operation: "image.generate",
      protocol: "ark:image-generations",
      parameters: { prompt: "cat", stream: true },
    },
    signal,
  );
  expect(result).toMatchObject({
    status: "succeeded",
    artifacts: [{ bytes: Buffer.from([1, 2, 3]) }],
    warnings: expect.any(Array),
  });
  expect(http).toHaveBeenCalledTimes(1);
});
it("rejects model/route mismatch before HTTP", async () => {
  const http = vi.fn();
  const p = new TokenDanceMediaProvider(
    async () => ({ baseURL: "https://example.com", apiKey: "fixture" }),
    http,
  );
  await expect(
    p.generate(
      {
        model: "seedream-5.0-pro",
        protocol: "minimax:t2a_v2",
        operation: "speech.synthesize",
        parameters: { prompt: "cat" },
      },
      signal,
    ),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(http).not.toHaveBeenCalled();
});
it("supports Pro layers and transparent output with mode constraints", () => {
  expect(
    normalizeParameters("seedream-5.0-pro", {
      layer_decomposition: true,
      image: png,
    }),
  ).toMatchObject({ size: "auto" });
  expect(
    normalizeParameters("seedream-5.0-pro", {
      prompt: "cat",
      image: png,
      background: "transparent",
      size: "1.5K",
    }),
  ).toMatchObject({ output_format: "png" });
  for (const p of [
    { layer_decomposition: true, image: [png, png] },
    { layer_decomposition: true, image: png, size: "2048x2048" },
    {
      prompt: "cat",
      image: png,
      background: "transparent",
      output_format: "jpeg",
    },
  ])
    expect(() => normalizeParameters("seedream-5.0-pro", p)).toThrow();
});
it("delivers all layers and their placement metadata", async () => {
  const http = vi.fn(async () =>
    Response.json({
      data: [
        { b64_json: "AQID", z_index: 0, name: "base" },
        {
          b64_json: "BAUG",
          z_index: 1,
          name: "cat",
          bounding_box: { absolute: [1, 2, 30, 40] },
        },
      ],
    }),
  );
  const p = new TokenDanceMediaProvider(
    async () => ({ baseURL: "https://example.com", apiKey: "fixture" }),
    http,
  );
  const r = await p.generate(
    {
      model: "seedream-5.0-pro",
      operation: "image.generate",
      protocol: "ark:image-generations",
      parameters: { layer_decomposition: true, image: png },
    },
    signal,
  );
  if (r.status !== "succeeded") throw Error("Expected layers");
  expect(r.artifacts).toHaveLength(3);
  expect(
    JSON.parse(Buffer.from(r.artifacts[2]!.bytes!).toString()).images[1],
  ).toMatchObject({
    artifact_index: 1,
    z_index: 1,
    bounding_box: { absolute: [1, 2, 30, 40] },
  });
});
it("rejects undersized inline PNGs before transport", () => {
  const b = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b);
  b.writeUInt32BE(10, 16);
  b.writeUInt32BE(10, 20);
  b[25] = 6;
  expect(() =>
    normalizeParameters("seedream-5.0-lite", {
      prompt: "cat",
      image: "data:image/png;base64," + b.toString("base64"),
    }),
  ).toThrow("dimensions");
});
it("supports Seedance queue settings, adaptive generation and last-frame delivery", async () => {
  const parameters = {
    content: [{ type: "text", text: "cat" }],
    ratio: "adaptive",
    priority: 9,
    return_last_frame: true,
    execution_expires_after: 3600,
    safety_identifier: "anonymous-session",
  };
  expect(normalizeParameters("seedance-2.5", parameters)).toMatchObject({
    priority: 9,
    ratio: "adaptive",
  });
  const p = new TokenDanceMediaProvider(
    async () => ({ baseURL: "https://example.com", apiKey: "fixture" }),
    vi.fn(async () =>
      Response.json({
        status: "succeeded",
        content: {
          video_url: "https://example.com/v.mp4",
          last_frame_url: png,
        },
      }),
    ),
  );
  expect(
    await p.queryTask(
      { id: "task", model: "seedance-2.5", protocol: "seedance:generations" },
      signal,
    ),
  ).toMatchObject({
    artifacts: [{ kind: "video" }, { kind: "image", url: png }],
  });
});
it("covers every generation model in the reviewed public catalog snapshot", async () => {
  const { readFile } = await import("node:fs/promises");
  const { parseMediaCatalog } = await import("./protocols.js");
  const catalog = JSON.parse(
    await readFile(
      new URL("./catalog-2026-09-09.json", import.meta.url),
      "utf8",
    ),
  );
  expect(
    parseMediaCatalog(catalog)
      .map((m) => m.id)
      .sort(),
  ).toEqual(catalog.data.map((m: { id: string }) => m.id).sort());
});
it("supports native HappyHorse editing references and sound preservation", () => {
  expect(
    normalizeParameters("happyhorse-1.0-video-edit", {
      input: {
        prompt: "replace sky",
        media: [
          { type: "video", url: "https://example.com/v.mp4" },
          { type: "reference_image", url: png },
        ],
      },
      parameters: { audio_setting: "origin", resolution: "1080P" },
    }),
  ).toMatchObject({ parameters: { audio_setting: "origin" } });
});

it("disables optional watermarks by default and honors an explicit opt-in", () => {
  for (const enabled of [undefined, false, true]) {
    expect(normalizeParameters("seedream-5.0-lite", { prompt: "cat", ...(enabled === undefined ? {} : { watermark: enabled }) }).watermark).toBe(enabled ?? false);
  }
});
