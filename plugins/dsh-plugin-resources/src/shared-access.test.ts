import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { ConversationLifecycle } from "@amiba/dsh-plugin-session-features";
import { ResourceCenter } from "./center.js";
import { resourceLink } from "./protocol.js";
import { readSharedResource, searchSharedResources } from "./shared-access.js";

it("only reads specifically shared references and never searches the owner's entire account", async () => {
  const root = await mkdtemp(join(tmpdir(), "shared-resources-"));
  try {
    const lifecycle = new ConversationLifecycle(root);
    const origin = { plugin: "lark", entry: "account", scope: "shared:group" };
    await lifecycle.adopt(origin, "session", 1);
    const ref = { source: "lark", connectionId: "account", identity: "user", kind: "document", id: "shared" };
    const center = new ResourceCenter();
    const search = vi.fn(async () => ({ items: [], unavailable: [] }));
    const read = vi.fn(async (requested: typeof ref) => ({ ref: requested, title: "Meeting", account: "Work", text: "project notes", truncated: false }));
    center.register({ id: "lark", search, read });
    const signal = new AbortController().signal;
    await expect(readSharedResource(center, lifecycle, origin, ref, signal)).rejects.toThrow("not_shared");
    expect(read).not.toHaveBeenCalled();
    await lifecycle.setSharedResources(origin, [{ reference: resourceLink(ref), title: "Meeting" }]);
    const result = await searchSharedResources(center, lifecycle, origin, { query: "project" }, signal);
    expect(result.items.map(item => item.ref.id)).toEqual(["shared"]);
    expect(search).not.toHaveBeenCalled();
    await expect(readSharedResource(center, lifecycle, origin, { ...ref, id: "private" }, signal)).rejects.toThrow("not_shared");
    await expect(readSharedResource(center, lifecycle, { ...origin, scope: "another-group" }, ref, signal)).rejects.toThrow("not_shared");
    let finish!: (doc: Awaited<ReturnType<typeof read>>) => void;
    read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = readSharedResource(center, lifecycle, origin, ref, signal);
    const rejected = expect(pending).rejects.toThrow("sharing_revoked");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await lifecycle.setSharedResources(origin, []);
    finish({ ref, title: "Meeting", account: "Work", text: "project notes", truncated: false });
    await rejected;
  } finally { await rm(root, { recursive: true, force: true }); }
});
