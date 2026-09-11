import { describe, expect, it, vi } from "vitest";
import { createMemoryAdapter } from "./memory-adapter.js";

function setup() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const remote = {
    beginCorrection: vi.fn(),
    update: vi.fn(),
    detail: vi.fn(),
    login: vi
      .fn()
      .mockResolvedValue({ ok: true, value: "memos_sess=test-token" }),
    overview: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        traces: 0,
        episodes: 0,
        policies: 0,
        worldModels: 0,
        skills: 0,
      },
    }),
    browse: vi.fn().mockResolvedValue({
      ok: true,
      value: { entries: [], total: 0, nextOffset: null },
    }),
  };
  return { values, storage, remote };
}
const query = { kind: "traces" as const, query: "", offset: 0 };
describe("remembered memory access", () => {
  it("restores the session after adapter recreation without storing the password", async () => {
    const { remote, storage, values } = setup();
    await createMemoryAdapter(remote, storage).login("private-password");
    await createMemoryAdapter(remote, storage).browse(query);
    expect(remote.browse).toHaveBeenLastCalledWith({
      ...query,
      session: "memos_sess=test-token",
    });
    expect([...values.values()]).toEqual(["memos_sess=test-token"]);
    expect(remote.login).toHaveBeenCalledTimes(1);
  });
  it("forgets rejected sessions so the next visit can request verification", async () => {
    const { remote, storage, values } = setup();
    const adapter = createMemoryAdapter(remote, storage);
    await adapter.login("password");
    remote.browse.mockResolvedValueOnce({
      ok: false,
      error: { message: "MEMOS_AUTH_REQUIRED" },
    });
    await expect(adapter.browse(query)).rejects.toThrow("MEMOS_AUTH_REQUIRED");
    expect(values.size).toBe(0);
    await createMemoryAdapter(remote, storage).overview();
    expect(remote.overview).toHaveBeenLastCalledWith(undefined);
  });
  it("keeps the session on temporary service failures", async () => {
    const { remote, storage, values } = setup();
    const adapter = createMemoryAdapter(remote, storage);
    await adapter.login("password");
    remote.browse.mockResolvedValueOnce({
      ok: false,
      error: { message: "MEMOS_UNAVAILABLE" },
    });
    await expect(adapter.browse(query)).rejects.toThrow("MEMOS_UNAVAILABLE");
    expect(values.size).toBe(1);
  });
});
