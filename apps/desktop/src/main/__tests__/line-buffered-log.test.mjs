import assert from "node:assert/strict";
import test from "node:test";

const { createLineBufferedLog } = await import("../line-buffered-log.ts");

test("prefixes every line in multi-line child process output", () => {
  const lines = [];
  const log = createLineBufferedLog("[hermes:start-gateway]", (line) =>
    lines.push(line),
  );

  log.write("┌────────┐\n│  ready │\n└────────┘\n");

  assert.deepEqual(lines, [
    "[hermes:start-gateway] ┌────────┐",
    "[hermes:start-gateway] │  ready │",
    "[hermes:start-gateway] └────────┘",
  ]);
});

test("reassembles split lines, preserves spacing, and flushes the final tail", () => {
  const lines = [];
  const log = createLineBufferedLog("[hermes:test]", (line) => lines.push(line));

  log.write("  left");
  log.write(" intact\r\nlast");
  assert.deepEqual(lines, ["[hermes:test]   left intact"]);

  log.flush();
  assert.deepEqual(lines, [
    "[hermes:test]   left intact",
    "[hermes:test] last",
  ]);
});
