import { afterEach, describe, expect, it, vi } from "vitest";
import { createResourceInputSource } from "./source.js";
import { encodeResourceRef } from "../protocol.js";
import type { ResourcesRemote } from "../remote.js";
const ref = {
  source: "lark",
  connectionId: "work",
  identity: "alice",
  kind: "contact",
  id: "person",
};
const doc = {
  ref,
  title: "张三",
  account: "工作账号",
  text: "private body",
  truncated: false,
};
function fixture() {
  const remote: ResourcesRemote = {
    search: vi.fn(async () => ({
      ok: true as const,
      value: { items: [doc], unavailable: [] },
    })),
    read: vi.fn(async () => ({ ok: true as const, value: doc })),
    reference: vi.fn(async () => ({ ok: true as const, value: doc })),
  };
  return { remote, source: createResourceInputSource(remote) };
}
afterEach(() => vi.useRealTimers());
describe("resource input source", () => {
  it("cancels debounce before querying personal resources", async () => {
    const { source, remote } = fixture(),
      controller = new AbortController();
    const result = source.candidates({} as never, {
      query: "张",
      position: "leading",
      signal: controller.signal,
    });
    controller.abort();
    await expect(result).rejects.toThrow();
    expect(remote.search).not.toHaveBeenCalled();
  });
  it("searches without session state and carries exact identity plus account hints", async () => {
    vi.useFakeTimers();
    const { source } = fixture();
    const result = source.candidates({} as never, {
      query: "张",
      position: "leading",
      signal: new AbortController().signal,
    });
    await vi.advanceTimersByTimeAsync(250);
    const candidates = await result;
    expect(candidates[0]?.hint).toBe("工作账号");
    const picked = source.onPick({
      candidate: candidates[0]!,
      session: {} as never,
      position: "leading",
      via: "menu",
      span: { start: 0, end: 2, draftRev: 1 },
    });
    expect(picked).toMatchObject({
      insert: { source: "resources", ref: encodeResourceRef(ref) },
    });
  });
  it("serializes a checked reference, not the private body", async () => {
    const { source, remote } = fixture();
    const value = await source.codec!.serialize(
      encodeResourceRef(ref),
      new AbortController().signal,
    );
    expect(remote.reference).toHaveBeenCalledWith(ref);
    expect(value).toContain("#amiba-reference?");
    expect(value).toContain("工作账号");
    expect(value).not.toContain("private body");
  });
  it("does not silently drop a denied reference when sending", async () => {
    const { source, remote } = fixture();
    remote.reference = vi.fn(
      async () => ({ ok: false, error: { message: "denied" } }) as never,
    );
    await expect(
      source.codec!.serialize(
        encodeResourceRef(ref),
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });
});
