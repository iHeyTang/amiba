import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// Execute the actual patched package methods, not a restatement of the patch.
const bundle = readFileSync(
  new URL(
    "../../node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js",
    import.meta.url,
  ),
  "utf8",
);
function method(name: string) {
  const start = bundle.indexOf(
    name === "open" ? "\t\t\topen(id, source" : `\t\t\t${name}(`,
  );
  expect(start).toBeGreaterThan(0);
  const end = bundle.indexOf("\n\t\t\t/**", start);
  return Function(`return ({${bundle.slice(start, end)}})`)()[name];
}

describe("pinned runtime navigation provenance", () => {
  it("publishes explicit intent before the synchronous list notification", () => {
    const selected = vi.fn();
    const runtime = {
      open: method("open"),
      lastOpenRequest: undefined as unknown,
      manager: {
        select(id: string) {
          selected(id, runtime.lastOpenRequest);
        },
      },
    };
    runtime.open("s1");
    expect(selected).toHaveBeenCalledWith("s1", {
      sessionId: "s1",
      source: "explicit",
    });
    const first = runtime.lastOpenRequest;
    runtime.open("s1");
    expect(runtime.lastOpenRequest).not.toBe(first);
  });

  it("restores prior intent and preserves the original exception on invalid selection", () => {
    const error = new Error("sessions.select: unknown session missing");
    const previous = { sessionId: "s1", source: "explicit" };
    const runtime = {
      open: method("open"),
      lastOpenRequest: previous,
      manager: {
        select() {
          throw error;
        },
      },
    };
    expect(() => runtime.open("missing")).toThrow(error);
    expect(runtime.lastOpenRequest).toBe(previous);
  });

  it("labels the actual startup policy separately and keeps its disposal behavior", async () => {
    const open = vi.fn();
    const unsubscribe = vi.fn();
    let finish!: (id: string) => void;
    const runtime = {
      startInitialSelection: method("startInitialSelection"),
      list: {
        getSnapshot: () => ({ baselinesReady: true, recentWorkspaceId: "w1" }),
        subscribe: () => unsubscribe,
      },
      sessions: { list: { getSnapshot: () => ({ current: undefined }) }, open },
      connectWorkspace: () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    };
    const dispose = runtime.startInitialSelection();
    finish("s1");
    await Promise.resolve();
    expect(open).toHaveBeenCalledWith("s1", "initial");
    dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(() => runtime.startInitialSelection()).toThrow("already started");
  });
});
