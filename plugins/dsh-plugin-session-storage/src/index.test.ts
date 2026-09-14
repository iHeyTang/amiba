import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { z } from "zod";
import { SessionStorage } from "./index.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const spec = defineDomain({
  name: "records",
  version: 1,
  tables: {
    items: domainTable<string, { title: string }>(
      z.object({ title: z.string() }),
    ),
  },
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "amiba-session-storage-"));
  roots.push(root);
  const ctx = {
    agents: { get: () => undefined },
    sessionPersistence: {
      stat: async (id: string) => {
        if (!["s1", "s2"].includes(id)) throw new Error("Unknown session");
        return { header: { id } };
      },
      resolveCurrentLog: async (id: string): Promise<string | undefined> => join(root, id, "session.jsonl.zstd"),
    },
  };
  return { root, ctx, newStorage: () => new SessionStorage(ctx as any) };
}
it("uses official durable JSON under the resolved session directory and reopens cold", async () => {
  const f = await fixture();
  const first = f.newStorage();
  const a = await first.open("s1", "background-jobs", spec);
  const b = await first.open("s2", "background-jobs", spec);
  const c = await first.open("s1", "other-plugin", spec);
  await Promise.all([
    a.table("items").put("same", { title: "first" }),
    b.table("items").put("same", { title: "second" }),
    c.table("items").put("same", { title: "other" }),
  ]);
  await first.close();
  expect(
    await readFile(
      join(f.root, "s1/plugins/background-jobs/records.json"),
      "utf8",
    ),
  ).toContain("first");
  const next = f.newStorage();
  expect(
    (await next.open("s1", "background-jobs", spec)).table("items").get("same"),
  ).toEqual({ title: "first" });
  expect(
    (await next.open("s2", "background-jobs", spec)).table("items").get("same"),
  ).toEqual({ title: "second" });
  expect(
    (await next.open("s1", "other-plugin", spec)).table("items").get("same"),
  ).toEqual({ title: "other" });
  await next.close();
});
it("rejects untrusted paths and backends without independent session directories", async () => {
  const f = await fixture();
  const store = f.newStorage();
  await expect(store.open("s1", "../../escape", spec)).rejects.toThrow(
    "namespace",
  );
  await expect(store.open("../../escape", "safe", spec)).rejects.toThrow(
    "Unknown session",
  );
  f.ctx.sessionPersistence.resolveCurrentLog = async () => undefined;
  await expect(store.open("s1", "safe", spec)).rejects.toThrow("JSONL");
  await store.close();
});


it("flushes a new live session before locating its deferred JSONL artifact", async () => {
  const f = await fixture();
  const session = { header: { id: "s1" } };
  let materialized = false;
  const flush = vi.fn(async (value: unknown) => { expect(value).toBe(session); materialized = true; return true });
  const store = new SessionStorage({ ...f.ctx, agents: { get: () => ({ session }) }, sessions: { flush }, sessionPersistence: { ...f.ctx.sessionPersistence, resolveCurrentLog: async () => materialized ? join(f.root, "s1", "session.jsonl.zstd") : undefined } } as any);
  const domain = await store.open("s1", "background-jobs", spec);
  await domain.table("items").put("job", { title: "new" });
  expect(flush).toHaveBeenCalledTimes(1);
  await store.close();
});
