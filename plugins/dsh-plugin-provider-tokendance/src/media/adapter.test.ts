import { expect, it } from "vitest";
import { TokenDanceMediaProvider } from "./adapter.js";
const connection = async () => ({
  baseURL: "https://fixture.test/gateway",
  apiKey: "fixture-key",
});
it("validates a model-specific field and queries without resubmission", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const http: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(
      init?.method === "POST"
        ? { id: "task/one" }
        : {
            status: "succeeded",
            content: { video_url: "https://fixture.test/video.mp4" },
          },
    );
  };
  const adapter = new TokenDanceMediaProvider(connection, http);
  const result = await adapter.generate(
    {
      model: "seedance-2.5",
      operation: "video.generate",
      protocol: "seedance:generations",
      parameters: {
        content: [{ type: "text", text: "hello" }],
        output_format: "mov",
      },
    },
    new AbortController().signal,
  );
  expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
    watermark: false,
    model: "seedance-2.5",
    content: [{ type: "text", text: "hello" }],
    output_format: "mov",
    duration: 5,
    resolution: "720p",
    ratio: "16:9",
  });
  expect(result.status).toBe("queued");
  if (result.status !== "queued") throw new Error("Expected task");
  expect(
    await adapter.queryTask(result.task, new AbortController().signal),
  ).toEqual({
    status: "succeeded",
    artifacts: [{ kind: "video", url: "https://fixture.test/video.mp4" }],
  });
  expect(calls[1]?.url).toContain("task%2Fone");
  expect(calls.filter((c) => c.init?.method === "POST")).toHaveLength(1);
});
it("does not retry an uncertain generation submission", async () => {
  let calls = 0;
  const adapter = new TokenDanceMediaProvider(connection, async () => {
    calls++;
    throw new Error("timeout");
  });
  await expect(
    adapter.generate(
      {
        model: "seedance-2.0",
        operation: "video.generate",
        protocol: "seedance:generations",
        parameters: { content: [{ type: "text", text: "hello" }] },
      },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "SUBMISSION_UNKNOWN" });
  expect(calls).toBe(1);
});
it("assembles Ark audio and treats its nonzero completion code as success", async () => {
  const adapter = new TokenDanceMediaProvider(
    connection,
    async () =>
      new Response(
        'data: {"code":0,"data":"YWJj"}\n\ndata: {"code":20000000}\n\n',
      ),
  );
  const result = await adapter.generate(
    {
      model: "seed-tts-2.0",
      operation: "speech.synthesize",
      protocol: "ark:tts",
      parameters: { req_params: { text: "hello" } },
    },
    new AbortController().signal,
  );
  expect(result.status).toBe("succeeded");
  if (result.status === "succeeded")
    expect(Buffer.from(result.artifacts[0]!.bytes!).toString()).toBe("abc");
});
it.each(["openai:image-generations", "ark:image-generations"])(
  "handles image bytes without injecting undocumented stream parameters: %s",
  async (protocol) => {
    let sent: Record<string, unknown> = {};
    const adapter = new TokenDanceMediaProvider(
      connection,
      async (_url, init) => {
        sent = JSON.parse(String(init?.body));
        return Response.json({ data: [{ b64_json: "AQID" }] });
      },
    );
    const output = await adapter.generate(
      {
        model: "seedream-5.0-lite",
        protocol,
        operation: "image.generate",
        parameters: { prompt: "cat" },
      },
      new AbortController().signal,
    );
    expect(sent).toMatchObject({
      model: "seedream-5.0-lite",
      prompt: "cat",
      size: "2K",
      response_format: "b64_json",
    });
    expect(output.status).toBe("succeeded");
    if (output.status === "succeeded")
      expect([...output.artifacts[0]!.bytes!]).toEqual([1, 2, 3]);
  },
);
it.each(["hex"])("supports MiniMax audio output_format %s", async (format) => {
  const adapter = new TokenDanceMediaProvider(
    connection,
    async (_url, init) => {
      expect(JSON.parse(String(init?.body)).output_format).toBe(format);
      return Response.json({
        data: {
          audio: format === "hex" ? "010203" : "https://fixture.test/audio.mp3",
        },
        base_resp: { status_code: 0 },
      });
    },
  );
  const output = await adapter.generate(
    {
      model: "minimax-speech-2.8-hd",
      protocol: "minimax:t2a_v2",
      operation: "speech.synthesize",
      parameters: { text: "hello", output_format: format },
    },
    new AbortController().signal,
  );
  expect(output.status).toBe("succeeded");
  if (output.status === "succeeded")
    expect(
      format === "hex"
        ? [...output.artifacts[0]!.bytes!]
        : output.artifacts[0]!.url,
    ).toEqual(format === "hex" ? [1, 2, 3] : "https://fixture.test/audio.mp3");
});
it("handles MiniMax video submission and query envelopes", async () => {
  const adapter = new TokenDanceMediaProvider(connection, async (_url, init) =>
    Response.json(
      init?.method === "POST"
        ? { task_id: "video-one" }
        : {
            task: {
              status: "succeeded",
              content: { url: "https://fixture.test/movie.mp4" },
            },
          },
    ),
  );
  const output = await adapter.generate(
    {
      model: "minimax-h3",
      protocol: "minimax:video_generation_v2",
      operation: "video.generate",
      parameters: { content: [{ type: "text", text: "hello" }] },
    },
    new AbortController().signal,
  );
  if (output.status !== "queued") throw new Error("Expected queued");
  expect(
    await adapter.queryTask(output.task, new AbortController().signal),
  ).toEqual({
    status: "succeeded",
    artifacts: [{ kind: "video", url: "https://fixture.test/movie.mp4" }],
  });
});
it("redacts credentials from explicit parameter errors", async () => {
  const adapter = new TokenDanceMediaProvider(
    connection,
    async () => new Response("invalid duration fixture-key", { status: 400 }),
  );
  await expect(
    adapter.generate(
      {
        model: "seedance-2.0",
        protocol: "seedance:generations",
        operation: "video.generate",
        parameters: { content: [{ type: "text", text: "hello" }] },
      },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    message: "Media API HTTP 400: invalid duration [redacted]",
  });
});
it('preserves image usage without inventing an actual charge', async()=>{
 const usage={generated_images:1,output_tokens:100,total_tokens:100};
 const adapter=new TokenDanceMediaProvider(connection,async()=>Response.json({data:[{b64_json:'AQI='}],usage}));
 const result=await adapter.generate({model:'seedream-5.0-lite',protocol:'ark:image-generations',operation:'image.generate',parameters:{prompt:'cat'}},new AbortController().signal);
 expect(result.accounting).toEqual({usage});expect(result.accounting?.cost).toBeUndefined();
});
it('preserves final SSE usage without summing stream events',async()=>{
 const usage={generated_images:1,output_tokens:200};
 const events=[{type:'image_generation.partial_succeeded',b64_json:'AQI='},{type:'image_generation.completed',usage}].map(value=>'data: '+JSON.stringify(value)+'\n\n').join('');
 const adapter=new TokenDanceMediaProvider(connection,async()=>new Response(events,{headers:{'Content-Type':'text/event-stream'}}));
 const result=await adapter.generate({model:'seedream-5.0-lite',protocol:'ark:image-generations',operation:'image.generate',parameters:{prompt:'cat',stream:true}},new AbortController().signal);
 expect(result.accounting).toEqual({usage});
});
