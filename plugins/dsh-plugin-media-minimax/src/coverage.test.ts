import { expect, it, vi } from "vitest";
import { minimaxModels, normalizeParameters } from "./model-contracts.js";
import { MiniMaxMediaProvider } from "./adapter.js";
import { audioResponse, wave } from "./audio-results.js";
const image = "https://example.com/cat.png";
const signal = new AbortController().signal;
const connection = async () => ({
  baseURL: "https://api.minimax.cn",
  apiKey: "fixture",
});
it.each(minimaxModels)("accepts an explicit valid request for %s", (model) => {
  const p = model.startsWith("image-")
    ? { prompt: "cat" }
    : model.startsWith("speech-")
      ? { text: "hello" }
      : model.startsWith("MiniMax-H3")
        ? { content: [{ type: "text", text: "cat" }] }
        : model.startsWith("music-cover")
          ? {
              prompt: "acoustic piano jazz cover",
              audio_url: "https://example.com/a.mp3",
            }
          : model.startsWith("music-")
            ? { prompt: "piano", is_instrumental: true }
            : model === "S2V-01"
              ? { subject_reference: [{ type: "character", image: [image] }] }
              : model.startsWith("I2V-") || model.endsWith("-Fast")
                ? { first_frame_image: image }
                : { prompt: "cat" };
  expect(normalizeParameters(model, p)).toBeTruthy();
});
it("supports mixing and effects while rejecting incompatible selections", () => {
  const p = normalizeParameters("speech-2.8-hd", {
    text: "hello",
    timbre_weights: [
      { voice_id: "a", weight: 25 },
      { voice_id: "b", weight: 75 },
    ],
    voice_modify: { pitch: 40, sound_effects: "robotic" },
    subtitle_enable: true,
    subtitle_type: "word",
  });
  expect(p.voice_setting).toMatchObject({ voice_id: "" });
  expect(p.timbre_weights).toHaveLength(2);
  for (const bad of [
    { stream: true, output_format: "url" },
    { voice_modify: { pitch: 1 }, audio_setting: { format: "opus" } },
    { audio_setting: { force_cbr: true } },
    { subtitle_type: "word_streaming", subtitle_enable: true },
  ])
    expect(() =>
      normalizeParameters("speech-2.8-hd", { text: "hi", ...bad }),
    ).toThrow();
});
it.each([
  ["MiniMax-Hailuo-02", { prompt: "cat", duration: 10, resolution: "1080P" }],
  ["MiniMax-Hailuo-2.3", { prompt: "cat", last_frame_image: image }],
  [
    "MiniMax-Hailuo-02",
    { first_frame_image: image, last_frame_image: image, resolution: "512P" },
  ],
  ["T2V-01", { prompt: "cat", duration: 10 }],
  [
    "music-cover",
    { audio_url: "https://example.com/a.mp3", cover_feature_id: "duplicate" },
  ],
  ["music-cover", { cover_feature_id: "id" }],
  ["music-3.0", { prompt: "piano" }],
] as const)("blocks bad combinations for %s", (m, p) =>
  expect(() => normalizeParameters(m, p)).toThrow(),
);
it("collects legacy video through the existing task and file IDs", async () => {
  const http = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ task_id: "task1" }))
    .mockResolvedValueOnce(
      Response.json({ status: "Success", file_id: "9007199254740993001" }),
    )
    .mockResolvedValueOnce(
      Response.json({ file: { download_url: "https://example.com/v.mp4" } }),
    );
  const provider = new MiniMaxMediaProvider(connection, http);
  const r = await provider.generate(
    {
      model: "MiniMax-Hailuo-02",
      protocol: "minimax:video_generation",
      operation: "video.generate",
      parameters: { first_frame_image: image, last_frame_image: image },
    },
    signal,
  );
  if (r.status !== "queued") throw Error("Expected queued");
  expect(await provider.queryTask(r.task, signal)).toMatchObject({
    artifacts: [{ url: "https://example.com/v.mp4" }],
  });
  expect(http.mock.calls.map((c) => (c[1] as RequestInit).method)).toEqual([
    "POST",
    "GET",
    "GET",
  ]);
  expect(http.mock.calls[2]?.[0]).toContain("9007199254740993001");
});
it("assembles aggregated speech once and preserves subtitle files", async () => {
  const data = [
    { data: { status: 1, audio: "0102" } },
    {
      data: {
        status: 2,
        audio: "01020304",
        subtitle_file: "https://example.com/subtitle.json",
      },
    },
  ]
    .map((x) => "data: " + JSON.stringify(x) + "\n\n")
    .join("");
  const result = await audioResponse(
    new Response(data, { headers: { "content-type": "text/event-stream" } }),
    { stream: true },
  );
  expect(result).toMatchObject({
    status: "succeeded",
    artifacts: [
      { bytes: Buffer.from([1, 2, 3, 4]) },
      { kind: "file", url: "https://example.com/subtitle.json" },
    ],
  });
});
it("assembles non-aggregated chunks and wraps raw PCM into playable WAV", async () => {
  const data = [
    { data: { status: 1, audio: "0102" } },
    { data: { status: 2, audio: "0304" } },
  ]
    .map((x) => "data: " + JSON.stringify(x) + "\n\n")
    .join("");
  const result = await audioResponse(
    new Response(data, { headers: { "content-type": "text/event-stream" } }),
    {
      stream: true,
      stream_options: { exclude_aggregated_audio: true },
      audio_setting: { format: "pcm", sample_rate: 16000, channel: 1 },
    },
  );
  if (result.status !== "succeeded") throw Error("Expected complete");
  const b = Buffer.from(result.artifacts[0]!.bytes!);
  expect(b.toString("ascii", 0, 4)).toBe("RIFF");
  expect(b.subarray(44)).toEqual(Buffer.from([1, 2, 3, 4]));
  expect(
    Buffer.from(wave(new Uint8Array([255, 127]), 8000, 1, true)).subarray(44),
  ).toEqual(Buffer.alloc(4));
});
it("rejects incomplete streams instead of reporting complete delivery", async () => {
  await expect(
    audioResponse(
      new Response('data: {"data":{"status":1,"audio":"0102"}}\n\n', {
        headers: { "content-type": "text/event-stream" },
      }),
      {},
    ),
  ).rejects.toMatchObject({ code: "SUBMISSION_UNKNOWN" });
});
it("submits music once and returns its output", async () => {
  const http = vi.fn(async (_input: unknown, _init?: RequestInit) =>
    Response.json({
      data: { audio: "01020304", status: 2 },
      base_resp: { status_code: 0 },
    }),
  );
  const p = new MiniMaxMediaProvider(connection, http);
  expect(
    await p.generate(
      {
        model: "music-3.0",
        operation: "audio.generate",
        protocol: "minimax:music_generation",
        parameters: { prompt: "piano", is_instrumental: true },
      },
      signal,
    ),
  ).toMatchObject({ status: "succeeded", artifacts: [{ kind: "audio" }] });
  expect(http).toHaveBeenCalledTimes(1);
  expect(http.mock.calls[0]?.[0]).toContain("/v1/music_generation");
});

it("disables speech watermarks by default and preserves an explicit opt-in", () => {
  expect(normalizeParameters("speech-2.8-hd", { text: "hello" }).aigc_watermark).toBe(false);
  expect(normalizeParameters("speech-2.8-hd", { text: "hello", aigc_watermark: true }).aigc_watermark).toBe(true);
});
