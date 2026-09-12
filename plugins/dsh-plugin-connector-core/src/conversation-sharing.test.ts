import { afterAll, expect, it, vi } from "vitest";
import { ResourceCenter, type ResourceSource } from "@amiba/dsh-plugin-resources";
import { resourceLink } from "@amiba/dsh-plugin-resources/protocol";
import { searchShareableResources, validateSharedResources } from "./conversation-sharing.js";
import { ConnectorCenter } from "./center.js";

// The host runs Node's AbortSignal.any; jsdom 25 does not provide it.
const originalAny = AbortSignal.any;
if (!originalAny) Object.defineProperty(AbortSignal, "any", { configurable: true, value: (signals: AbortSignal[]) => {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) { controller.abort(signal.reason); break; }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true, signal: controller.signal });
  }
  return controller.signal;
} });
afterAll(() => { if (!originalAny) Reflect.deleteProperty(AbortSignal, "any"); });

const ref = { source: "fake", connectionId: "account", identity: "owner", kind: "document", id: "doc" };
const document = { ref, title: "Project notes", account: "Work", text: "Private content", truncated: false };
function fixture() {
  const resources = new ResourceCenter();
  const search = vi.fn<ResourceSource["search"]>(async () => ({ items: [document], unavailable: [] }));
  const read = vi.fn<ResourceSource["read"]>(async () => document);
  resources.register({ id: "fake", search, read });
  return { resources, search, read };
}
it("searches only the selected account and returns choices without private document bodies", async () => {
  const { resources, search, read } = fixture();
  const result = await searchShareableResources(resources, "account", "Project");
  expect(search).toHaveBeenCalledWith({ connectionId: "account", query: "Project" }, "preview", expect.any(AbortSignal));
  expect(result.items).toEqual([{ reference: resourceLink(ref), title: "Project notes" }]);
  expect(read).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain("Private content");
});
it("verifies new grants with the owner authority and rejects another account before reading", async () => {
  const { resources, read } = fixture();
  await expect(validateSharedResources(resources, "other", [resourceLink(ref)], [])).rejects.toThrow("account_mismatch");
  expect(read).not.toHaveBeenCalled();
  expect(await validateSharedResources(resources, "account", [resourceLink(ref), resourceLink(ref)], [])).toEqual([{ reference: resourceLink(ref), title: document.title }]);
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith(ref, "preview", expect.any(AbortSignal));
});
it("can retain or revoke grants offline, but cannot add unavailable resources", async () => {
  const previous = [{ reference: resourceLink(ref), title: document.title }];
  expect(await validateSharedResources(undefined, "account", [], previous)).toEqual([]);
  expect(await validateSharedResources(undefined, "account", [resourceLink(ref)], previous)).toEqual(previous);
  await expect(validateSharedResources(undefined, "account", [resourceLink({ ...ref, id: "new" })], previous)).rejects.toThrow("source_unavailable");
});
it("does not return a grant when platform authorization has been revoked", async () => {
  const { resources, read } = fixture();
  read.mockRejectedValueOnce(new Error("authorization_revoked"));
  await expect(validateSharedResources(resources, "account", [resourceLink(ref)], [])).rejects.toThrow("authorization_revoked");
});

it("the connector uses its own stored channel and commits no grants after a failed validation", async () => {
  const { resources, read } = fixture();
  const view = { access: "shared", currentSessionId: "shared-session", sharedResources: [] };
  const messaging = { conversationSettings: vi.fn(async () => view), shareConversationResources: vi.fn(async () => view) };
  const center = new ConnectorCenter({ reflect: { get: () => resources } } as never, { list: async () => [{ id: "account", channelId: "owned-channel" }] } as never, messaging as never, {} as never, new Map());
  await center.shareConversationResources("account", "group", [resourceLink(ref)]);
  expect(messaging.conversationSettings).toHaveBeenCalledWith("owned-channel", "group", { action: "status" });
  expect(messaging.shareConversationResources).toHaveBeenCalledWith("owned-channel", "group", [{ reference: resourceLink(ref), title: document.title }]);
  messaging.shareConversationResources.mockClear();
  read.mockRejectedValueOnce(new Error("revoked"));
  await expect(center.shareConversationResources("account", "group", [resourceLink(ref)])).rejects.toThrow("revoked");
  expect(messaging.shareConversationResources).not.toHaveBeenCalled();
  await expect(center.shareConversationResources("another-account", "group", [])).rejects.toThrow("connect_not_found");
});
