import { describe, expect, it, vi } from "vitest";
import { createConnectWizardRegistry } from "../wizard-registry";

const entry = { component: () => null };

describe("createConnectWizardRegistry", () => {
  it("registers, gets, and lists providers", () => {
    const r = createConnectWizardRegistry();
    r.register("lark", entry);
    expect(r.get("lark")).toBe(entry);
    expect(r.list()).toEqual(["lark"]);
    expect(r.get("dingtalk")).toBeUndefined();
  });

  it("dispose removes the entry", () => {
    const r = createConnectWizardRegistry();
    const dispose = r.register("lark", entry);
    dispose();
    expect(r.get("lark")).toBeUndefined();
    expect(r.list()).toEqual([]);
  });

  it("throws on a duplicate provider id", () => {
    const r = createConnectWizardRegistry();
    r.register("lark", entry);
    expect(() => r.register("lark", entry)).toThrow(/duplicate/i);
  });

  it("notifies subscribers on register and dispose, and stops after unsubscribe", () => {
    const r = createConnectWizardRegistry();
    const listener = vi.fn();
    const unsub = r.subscribe(listener);
    const dispose = r.register("lark", entry);
    expect(listener).toHaveBeenCalledTimes(1);
    dispose();
    expect(listener).toHaveBeenCalledTimes(2);
    unsub();
    r.register("dingtalk", entry);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
