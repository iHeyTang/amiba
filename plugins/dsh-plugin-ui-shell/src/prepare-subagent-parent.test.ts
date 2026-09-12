import { beforeEach, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
const inspect = vi.fn();
import { prepareSubagentParent } from "./prepare-subagent-parent.js";
function fixture() {
  const resolve = vi.fn(async () => ({ id: "parent" }));
  const live = vi.fn(() => undefined as unknown);
  const services: Record<string, unknown> = { sessionPersistence: { list: async () => [{ id: "child", origin: "subagent" }], inspect }, agents: { get: live }, typert: { lookups: { get: () => ({ resolve }) } } };
  const host = { reflect: { get: (key: string) => services[key] } } as unknown as Context;
  return { host, services, resolve, live };
}
const child = () => ({ meta: { origin: "subagent", parentSession: "parent" }, events: [{ type: "subagent/descriptor", data: { version: 2, mode: "continuable" } }] });
beforeEach(() => { inspect.mockReset(); inspect.mockResolvedValue(child()); });
it("uses the configured official resolver for the persisted direct parent", async () => {
  const { host, resolve } = fixture();
  await prepareSubagentParent(host, "child");
  expect(inspect).toHaveBeenCalledWith("child");
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(resolve).toHaveBeenCalledWith("parent");
});
it("keeps a live direct parent under its existing owner, including nested parents", async () => {
  const { host, resolve, live } = fixture();
  live.mockReturnValue({ id: "parent", owner: "grandparent" });
  await prepareSubagentParent(host, "child");
  expect(resolve).not.toHaveBeenCalled();
});
it.each([
  { meta: {}, events: [] },
  { ...child(), events: [{ type: "subagent/descriptor", data: { version: 2, mode: "one-shot" } }] },
  { ...child(), events: [{ type: "subagent/descriptor", data: { version: 3, mode: "continuable" } }] },
  { ...child(), meta: { ...child().meta, seedLength: 1 } },
])("does not recover a parent for ordinary, terminal, unsupported or inherited descriptors", async stored => {
  inspect.mockResolvedValue(stored);
  const { host, resolve } = fixture();
  await prepareSubagentParent(host, "child");
  expect(resolve).not.toHaveBeenCalled();
});
it("allows a new ordinary identity but preserves persistence failures", async () => {
  const { host, resolve } = fixture();
  await prepareSubagentParent(host, "new");
  inspect.mockRejectedValueOnce(new Error("unreadable log"));
  await expect(prepareSubagentParent(host, "child")).rejects.toThrow("unreadable log");
  expect(resolve).not.toHaveBeenCalled();
});
it("preserves ownership and missing-parent rejections without creating a substitute", async () => {
  const { host, resolve } = fixture();
  resolve.mockRejectedValueOnce(new Error("agent-busy: subagent owned parent"));
  await expect(prepareSubagentParent(host, "child")).rejects.toThrow("agent-busy");
  resolve.mockResolvedValueOnce(undefined as never);
  await expect(prepareSubagentParent(host, "child")).rejects.toThrow("recovery is unavailable");
});
it("fails clearly if lookup is unavailable and rejects self-parent cycles", async () => {
  const { host, services, resolve } = fixture();
  delete services.typert;
  await expect(prepareSubagentParent(host, "child")).rejects.toThrow("recovery is unavailable");
  inspect.mockResolvedValue({ ...child(), meta: { ...child().meta, parentSession: "child" } });
  await expect(prepareSubagentParent(host, "child")).rejects.toThrow("Invalid subagent parent");
  expect(resolve).not.toHaveBeenCalled();
});
