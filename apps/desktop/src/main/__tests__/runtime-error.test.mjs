import assert from "node:assert/strict";
import test from "node:test";

const { toChatRuntimeError } = await import("../chat/runtime-error.ts");

test("runtime errors call method hints and remain Electron-serializable", () => {
  class GatewayError extends Error {
    status = 502;

    hint() {
      return "Restart the local Hermes gateway.";
    }
  }

  const normalized = toChatRuntimeError(
    new GatewayError("Hermes 502: gateway unreachable"),
  );

  assert.deepEqual(normalized, {
    message: "Hermes 502: gateway unreachable",
    status: 502,
    hint: "Restart the local Hermes gateway.",
  });
  assert.deepEqual(structuredClone(normalized), normalized);
});

test("runtime errors discard non-serializable optional fields", () => {
  const normalized = toChatRuntimeError({
    message: "provider failed",
    status: "502",
    hint: () => ({ retry: true }),
  });

  assert.deepEqual(normalized, { message: "provider failed" });
  assert.deepEqual(structuredClone(normalized), normalized);
});
