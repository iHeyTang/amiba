import { expect, it, vi } from "vitest";
import { MiniMaxMediaProvider } from "./adapter.js";
import { minimaxConnection } from "./connection.js";
const connection = async () => ({
  baseURL: "https://api.minimax.cn",
  apiKey: "test-key",
});
const signal = new AbortController().signal;
it("rejects invalid model parameters without sending or charging a request", async () => {
  const http = vi.fn();
  const p = new MiniMaxMediaProvider(connection, http);
  await expect(
    p.generate(
      {
        model: "MiniMax-H3-Max",
        protocol: "minimax:video_generation_v2",
        operation: "video.generate",
        parameters: {
          content: [{ type: "text", text: "cat" }],
          resolution: "2K",
        },
      },
      signal,
    ),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(http).not.toHaveBeenCalled();
});
it("creates and collects a video task with exactly one submission", async () => {
  const http = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ task_id: "task/1" }))
    .mockResolvedValueOnce(
      Response.json({
        task: {
          status: "succeeded",
          content: { url: "https://example.com/a.mp4" },
        },
      }),
    );
  const p = new MiniMaxMediaProvider(connection, http);
  const result = await p.generate(
    {
      model: "MiniMax-H3",
      protocol: "minimax:video_generation_v2",
      operation: "video.generate",
      parameters: { content: [{ type: "text", text: "cat" }] },
    },
    signal,
  );
  if (result.status !== "queued") throw Error("Expected queued");
  expect(await p.queryTask(result.task, signal)).toMatchObject({
    status: "succeeded",
  });
  expect(http.mock.calls[1]?.[0]).toContain("task%2F1");
  expect(JSON.parse(http.mock.calls[0]?.[1].body)).toMatchObject({
    resolution: "768P",
    duration: 5,
    ratio: "16:9",
  });
});
it("returns inline image bytes and does not retry ambiguous submissions", async () => {
  const http = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        data: { image_base64: ["AQID"] },
        base_resp: { status_code: 0 },
      }),
    )
    .mockRejectedValue(new Error("timeout"));
  const p = new MiniMaxMediaProvider(connection, http);
  const request = {
    model: "image-01",
    protocol: "minimax:image_generation",
    operation: "image.generate" as const,
    parameters: { prompt: "cat" },
  };
  expect(await p.generate(request, signal)).toMatchObject({
    status: "succeeded",
    artifacts: [{ bytes: Buffer.from([1, 2, 3]) }],
  });
  await expect(p.generate(request, signal)).rejects.toMatchObject({
    code: "SUBMISSION_UNKNOWN",
  });
  expect(http).toHaveBeenCalledTimes(2);
});
it("uses only public DSH directory, settings and credentials and re-resolves changes", async () => {
  let value = "first";
  const profile = {
    apiKeyEnv: "MINIMAX_KEY",
    baseURL: "https://api.minimaxi.com/anthropic",
  };
  const resolve = vi.fn(async () => ({ value }));
  const ctx = {
    llm: {
      listProviders: () => [{ id: "minimax-cn" }],
      listConfigurableProviders: () => [
        {
          provider: "minimax-cn",
          settingsNs: "llm-pi-ai",
          settingsPath: ["providers", "minimax-cn"],
        },
      ],
    },
    settings: { get: () => ({ providers: { "minimax-cn": profile } }) },
    credentials: { resolve },
  };
  expect(await minimaxConnection(ctx as never)).toMatchObject({
    apiKey: "first",
    baseURL: "https://api.minimaxi.com",
  });
  value = "second";
  expect((await minimaxConnection(ctx as never)).apiKey).toBe("second");
  expect(resolve).toHaveBeenCalledWith("MINIMAX_KEY");
  profile.baseURL = "https://unrelated.example";
  await expect(minimaxConnection(ctx as never)).rejects.toThrow("official API");
  delete (profile as any).apiKeyEnv;
  await expect(minimaxConnection(ctx as never)).rejects.toThrow("OAuth");
});
it("checks account voice IDs with a read-only request before paid synthesis", async () => {
  const http = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        system_voice: [{ voice_id: "male-qn-qingse" }],
        base_resp: { status_code: 0 },
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        data: { audio: "010203" },
        base_resp: { status_code: 0 },
      }),
    );
  const p = new MiniMaxMediaProvider(connection, http);
  expect(
    await p.generate(
      {
        model: "speech-2.8-hd",
        protocol: "minimax:t2a_v2",
        operation: "speech.synthesize",
        parameters: { text: "hello" },
      },
      signal,
    ),
  ).toMatchObject({ status: "succeeded" });
  expect(http.mock.calls[0]?.[0]).toContain("/v1/get_voice");
  expect(http.mock.calls[1]?.[0]).toContain("/v1/t2a_v2");
  http
    .mockReset()
    .mockResolvedValue(
      Response.json({
        system_voice: [{ voice_id: "known" }],
        base_resp: { status_code: 0 },
      }),
    );
  await expect(
    p.generate(
      {
        model: "speech-2.8-hd",
        protocol: "minimax:t2a_v2",
        operation: "speech.synthesize",
        parameters: { text: "hello", voice_setting: { voice_id: "missing" } },
      },
      signal,
    ),
  ).rejects.toThrow("Voice is not available");
  expect(http).toHaveBeenCalledTimes(1);
});
