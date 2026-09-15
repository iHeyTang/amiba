import { expect, it, vi } from "vitest";
import { ensureSessionWorkspace, resolveSessionCreationWorkspace, type PlatformAdapter } from "./index";

function fixture() {
  const workspaces = {
    listBindings: vi.fn(async (): Promise<Record<string, string>> => ({})),
    getCurrent: vi.fn(async () => "/default"),
    getDefaultRoot: vi.fn(async () => "/default/Amiba/workspace"),
    bindIfUnbound: vi.fn(async (_id: string, cwd: string) => cwd),
  };
  const agentSessions = { list: vi.fn(async () => [{ sessionId: "target", cwd: "/host-root" }]) };
  return { workspaces, agentSessions, platform: { workspaces, agentSessions } as unknown as PlatformAdapter };
}

it("restores an existing Host target before file access and engine submission", async () => {
  const f = fixture();
  expect(await ensureSessionWorkspace("target", f.platform)).toBe("/host-root");
  expect(f.workspaces.bindIfUnbound).toHaveBeenCalledWith("target", "/host-root");
  expect(f.workspaces.getCurrent).not.toHaveBeenCalled();
});
it("preserves a chosen local binding without consulting the Host", async () => {
  const f = fixture(); f.workspaces.listBindings.mockResolvedValue({ target: "/chosen" });
  expect(await ensureSessionWorkspace("target", f.platform)).toBe("/chosen");
  expect(f.agentSessions.list).not.toHaveBeenCalled();
  expect(f.workspaces.bindIfUnbound).not.toHaveBeenCalled();
});
it("uses the mutation authority's result if a binding appeared after the initial read", async () => {
  const f = fixture(); f.workspaces.bindIfUnbound.mockResolvedValue("/concurrent-choice");
  expect(await ensureSessionWorkspace("target", f.platform)).toBe("/concurrent-choice");
});
it("keeps the product default for a genuinely new session", async () => {
  const f = fixture();
  expect(await ensureSessionWorkspace("new", f.platform)).toBe("/default/Amiba/workspace");
  expect(f.workspaces.bindIfUnbound).not.toHaveBeenCalled();
});
it("does not silently replace a failed Host read with a different default directory", async () => {
  const f = fixture(); f.agentSessions.list.mockRejectedValue(new Error("Host unavailable"));
  await expect(ensureSessionWorkspace("target", f.platform)).rejects.toThrow("Host unavailable");
  expect(f.workspaces.getCurrent).not.toHaveBeenCalled();
});
it("leaves hosts without a desktop workspace adapter available", async () => {
  expect(await ensureSessionWorkspace("target", {} as PlatformAdapter)).toBeUndefined();
});

it("shared main/Quick Ask creation preserves Host cwd identity without creating a canonicalized workspace", async () => {
  const f = fixture();
  const resolveRuntimeCwd = vi.fn(async () => "/host-spelling");
  f.platform.workspaces!.resolveRuntimeCwd = resolveRuntimeCwd;
  const create = vi.fn(); f.platform.agentWorkspaces = { create } as unknown as PlatformAdapter["agentWorkspaces"];
  expect(await resolveSessionCreationWorkspace("target", f.platform)).toEqual({ cwd: "/host-spelling" });
  expect(resolveRuntimeCwd).toHaveBeenCalledWith("target", "/host-root");
  expect(create).not.toHaveBeenCalled();
});
it("shared creation keeps the existing workspace registry path for a new explicitly bound task", async () => {
  const f = fixture(); f.workspaces.listBindings.mockResolvedValue({ new: "/chosen" });
  const create = vi.fn(async () => ({ workspace: { workspaceId: "registered" } }));
  f.platform.agentWorkspaces = { create } as unknown as PlatformAdapter["agentWorkspaces"];
  expect(await resolveSessionCreationWorkspace("new", f.platform)).toEqual({ workspaceId: "registered" });
  expect(create).toHaveBeenCalledWith("/chosen");
});

it("does not create a task when the default workspace cannot be prepared", async () => {
  const f = fixture();
  f.workspaces.getDefaultRoot.mockRejectedValue(new Error("Workspace is not writable"));
  await expect(resolveSessionCreationWorkspace("new", f.platform)).rejects.toThrow("not writable");
});
