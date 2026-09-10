import { createServer } from "node:http";
import { expect, it } from "vitest";
import { TokenDanceMediaProvider } from "./adapter.js";
import { MEDIA_PROTOCOLS } from "./protocols.js";
it("executes every shipped media protocol over HTTP, including both video queries and SSE", async () => {
  const requests: Array<{
    path: string;
    method: string;
    body: Record<string, unknown>;
    modelHeader?: string;
  }> = [];
  const server = createServer(async (req, res) => {
    expect(req.headers.authorization).toBe("Bearer fixture-key");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString())
      : {};
    const path = req.url!;
    requests.push({
      path,
      method: req.method!,
      body,
      modelHeader: req.headers["x-api-resource-id"] as string | undefined,
    });
    res.setHeader("content-type", "application/json");
    if (path.includes("images/generations"))
      res.end(JSON.stringify({ data: [{ b64_json: "AQID" }] }));
    else if (path.includes("tts/unidirectional")) {
      res.setHeader("content-type", "text/event-stream");
      res.write('data: {"code":0,"data":"AQID"}\n');
      res.end('\ndata: {"code":20000000}\n\n');
    } else if (path.includes("t2a_v2"))
      res.end(
        JSON.stringify({
          data: { audio: "010203" },
          base_resp: { status_code: 0 },
        }),
      );
    else if (path.includes("/kling/"))
      res.end(
        JSON.stringify(
          req.method === "POST"
            ? { data: { id: "task-id" } }
            : {
                status: "succeeded",
                data: [
                  {
                    outputs: [
                      { type: "video", url: "https://fixture.test/output.mp4" },
                    ],
                  },
                ],
              },
        ),
      );
    else if (path.includes("/alibaba/"))
      res.end(
        JSON.stringify(
          req.method === "POST"
            ? { output: { task_id: "task-id" } }
            : {
                output: {
                  task_status: "SUCCEEDED",
                  video_url: "https://fixture.test/output.mp4",
                },
              },
        ),
      );
    else if (req.method === "POST") res.end(JSON.stringify({ id: "task-id" }));
    else if (path.includes("/minimax/"))
      res.end(
        JSON.stringify({
          task: {
            status: "succeeded",
            content: { url: "https://fixture.test/output.mp4" },
          },
        }),
      );
    else
      res.end(
        JSON.stringify({
          status: "succeeded",
          content: { video_url: "https://fixture.test/output.mp4" },
        }),
      );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No server port");
  const adapter = new TokenDanceMediaProvider(async () => ({
    baseURL: `http://127.0.0.1:${address.port}/gateway`,
    apiKey: "fixture-key",
  }));
  try {
    for (const protocol of MEDIA_PROTOCOLS) {
      const model =
        protocol.result === "kling-video"
          ? protocol.id.endsWith("omni-video")
            ? "kling-3.0-omni"
            : "kling-3.0"
          : protocol.result === "alibaba-video"
            ? protocol.id.startsWith("wan3")
              ? "wan3.0-video"
              : "happyhorse-1.1-t2v"
            : protocol.result === "images"
              ? "seedream-5.0-lite"
              : protocol.result === "seedance"
                ? "seedance-2.5"
                : protocol.result === "minimax-video"
                  ? "minimax-h3"
                  : protocol.result === "ark-audio"
                    ? "seed-tts-2.0"
                    : "minimax-speech-2.8-hd";
      const parameters =
        protocol.result === "kling-video"
          ? protocol.id.endsWith("text2video")
            ? { prompt: "cat" }
            : {
                contents: [
                  { type: "prompt", text: "cat" },
                  ...(protocol.id.endsWith("image2video")
                    ? [
                        {
                          type: "first_frame",
                          url: "https://example.com/cat.png",
                        },
                      ]
                    : []),
                ],
              }
          : protocol.result === "alibaba-video"
            ? { input: { prompt: "cat" } }
            : protocol.result === "images"
              ? { prompt: "cat" }
              : protocol.result === "ark-audio"
                ? { req_params: { text: "hello" } }
                : protocol.result === "minimax-audio"
                  ? { text: "hello" }
                  : { content: [{ type: "text", text: "cat" }] };
      const result = await adapter.generate(
        {
          model,
          protocol: protocol.id,
          operation: protocol.operations[0]!,
          parameters,
        },
        new AbortController().signal,
      );
      const post = [...requests]
        .reverse()
        .find((row) => row.method === "POST")!;
      expect(post.path).toBe(`/gateway${protocol.path}`);
      expect(post.body).not.toHaveProperty("native_extension");
      expect(
        protocol.result === "ark-audio"
          ? post.modelHeader
          : protocol.result === "kling-video"
            ? post.body.model_name
            : post.body.model,
      ).toBe(model);
      if (result.status === "queued")
        expect(
          (await adapter.queryTask(result.task, new AbortController().signal))
            .status,
        ).toBe("succeeded");
      else expect(result.status).toBe("succeeded");
    }
    expect(requests.filter((row) => row.method === "POST")).toHaveLength(
      MEDIA_PROTOCOLS.length,
    );
    expect(requests.filter((row) => row.method === "GET")).toHaveLength(
      MEDIA_PROTOCOLS.filter((p) => p.queryPath).length,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
