import { expect, it } from "vitest";
import { sseData } from "./sse.js";
it("frames multiline SSE split at every UTF-8 byte and handles CRLF", async () => {
  const bytes = new TextEncoder().encode(': ping\r\ndata: {"text":"你好",\r\ndata: "done":true}\r\n\r\ndata: final');
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    controller.close();
  } });
  const results: string[] = [];
  for await (const event of sseData(stream)) results.push(event);
  expect(results).toEqual(['{"text":"你好",\n"done":true}', 'final']);
});
