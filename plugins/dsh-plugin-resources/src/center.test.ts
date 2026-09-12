import { describe, expect, it, vi } from "vitest";
import { ResourceCenter, type ResourceSource } from "./center.js";
import {
  decodeResourceRef,
  encodeResourceRef,
  externalUrl,
  parseResourceLink,
  resourceLink,
  type ResourceRef,
} from "./protocol.js";
const ref: ResourceRef = {
  source: "fake",
  connectionId: "account-a",
  identity: "alice",
  kind: "document",
  id: "doc/中文",
};
const summary = { ref, title: "Document", account: "Work" };
const document = { ...summary, text: "external content", truncated: false };
function source(): ResourceSource {
  return {
    id: "fake",
    search: vi.fn(async () => ({ items: [summary], unavailable: [] })),
    read: vi.fn(async () => document),
  };
}
describe("account-bound resources", () => {
  it("returns strictly JSON-safe objects across the DSH boundary", async () => {
    const center = new ResourceCenter();
    center.register(source());
    const values = [
      await center.read(ref),
      await center.search({ query: "abc" }),
    ];
    for (const value of values)
      expect(JSON.parse(JSON.stringify(value))).toStrictEqual(value);
  });
  it("round-trips opaque identifiers without confusing account/identity boundaries", () => {
    expect(decodeResourceRef(encodeResourceRef(ref))).toEqual(ref);
    expect(encodeResourceRef({ ...ref, connectionId: "account-b" })).not.toBe(
      encodeResourceRef(ref),
    );
    expect(encodeResourceRef({ ...ref, identity: "bob" })).not.toBe(
      encodeResourceRef(ref),
    );
    expect(() => decodeResourceRef("fake/account/document/id")).toThrow();
  });
  it("resolves both tool locators and mention citations without changing identity", () => {
    const citation = `#amiba-reference?${new URLSearchParams({
      source: "resources", ref: encodeResourceRef(ref),
    })}`;
    expect(parseResourceLink(resourceLink(ref))).toEqual(ref);
    expect(parseResourceLink(citation)).toEqual(ref);
    expect(() => parseResourceLink(citation.replace("source=resources", "source=other"))).toThrow();
  });
  it("uses a single registry for UI and model purposes", async () => {
    const center = new ResourceCenter(),
      provider = source();
    center.register(provider);
    await center.search({ query: "abc" }, "model");
    await center.read(ref, "preview");
    expect(provider.search).toHaveBeenCalledWith(
      { query: "abc" },
      "model",
      expect.any(AbortSignal),
    );
    expect(provider.read).toHaveBeenCalledWith(
      ref,
      "preview",
      expect.any(AbortSignal),
    );
  });
  it("rejects duplicate sources and permits clean re-registration", () => {
    const center = new ResourceCenter(),
      provider = source(),
      off = center.register(provider);
    expect(() => center.register(source())).toThrow("duplicate");
    off();
    center.register(source());
    off();
    expect(center.read(ref)).resolves.toEqual(document);
  });
  it("reports unavailable sources separately from empty matches", async () => {
    const center = new ResourceCenter();
    expect(await center.search({ query: "abc", source: "fake" })).toEqual({
      items: [],
      unavailable: [{ source: "fake", reason: "source_not_registered" }],
    });
  });
  it("rejects a provider returning a different account or identity", async () => {
    const center = new ResourceCenter(),
      provider = source();
    provider.read = async () => ({
      ...document,
      ref: { ...ref, identity: "bob" },
    });
    center.register(provider);
    await expect(center.read(ref)).rejects.toThrow("identity_mismatch");
    expect(
      (await center.search({ query: "abc", connectionId: "account-b" })).items,
    ).toEqual([]);
  });
  it("bounds content and strips executable or credential-bearing source URLs", async () => {
    const center = new ResourceCenter(),
      provider = source();
    provider.read = async () => ({
      ...document,
      text: "x".repeat(60_000),
      url: "javascript:alert(1)",
    });
    center.register(provider);
    const value = await center.read(ref);
    expect(value.text).toHaveLength(40_000);
    expect(value.truncated).toBe(true);
    expect(value.url).toBeUndefined();
    expect(externalUrl("https://name:secret@example.com/doc")).toBeUndefined();
  });
  it("cancels reads immediately on plugin unload, even for non-cooperative providers", async () => {
    const center = new ResourceCenter(),
      provider = source();
    provider.read = () => new Promise(() => undefined);
    const off = center.register(provider);
    const result = center.read(ref);
    off();
    await expect(result).rejects.toThrow("cancelled");
    await expect(center.read(ref)).rejects.toThrow("source_unavailable");
  });
  it("does not leak upstream errors or allow one source failure to break another", async () => {
    const center = new ResourceCenter();
    center.register(source());
    center.register({
      ...source(),
      id: "bad",
      search: async () => {
        throw new Error("secret token");
      },
    });
    const value = await center.search({ query: "abc" });
    expect(value.items).toHaveLength(1);
    expect(JSON.stringify(value)).not.toContain("secret token");
    expect(value.unavailable).toHaveLength(1);
  });
  it("cancels fanout when its caller aborts", async () => {
    const center = new ResourceCenter(),
      provider = source();
    provider.search = () => new Promise(() => undefined);
    center.register(provider);
    const controller = new AbortController();
    const result = center.search(
      { query: "abc" },
      "preview",
      controller.signal,
    );
    controller.abort();
    await expect(result).rejects.toThrow();
  });
});

it("distinguishes missing capability registration from personal authorization", async()=>{const center=new ResourceCenter();expect(center.listSources()).toEqual([]);expect((await center.search({query:"docs",source:"dingtalk"})).unavailable[0]?.reason).toBe("source_not_registered");center.register({id:"dingtalk",search:async()=>({items:[],unavailable:[{source:"dingtalk",reason:"personal_authorization_required"}]}),read:async()=>{throw new Error("unused")}});expect(center.listSources()).toEqual(["dingtalk"]);expect((await center.search({query:"docs",source:"dingtalk"})).unavailable[0]?.reason).toBe("personal_authorization_required");});
