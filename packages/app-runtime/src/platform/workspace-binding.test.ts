import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("../../../../apps/desktop/src/main/storage", () => ({
  mainStore: { get: async () => ({}), set: vi.fn(async () => {}) },
}));
import { workspaceManager } from "../../../../apps/desktop/src/main/workspace";
const roots: string[] = [];
afterEach(async () => {
  await workspaceManager.dispose();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function directories() {
  const root = await mkdtemp(join(tmpdir(), "amiba-root-restore-")); roots.push(root);
  await mkdir(join(root, "host")); await mkdir(join(root, "chosen"));
  return { host: await realpath(join(root, "host")), chosen: await realpath(join(root, "chosen")) };
}
it("restores one root when two restorations arrive together", async () => {
  const { host, chosen } = await directories();
  expect(await Promise.all([
    workspaceManager.bindIfUnbound("race", host), workspaceManager.bindIfUnbound("race", chosen),
  ])).toEqual([host, host]);
  expect(workspaceManager.getForSession("race")).toBe(host);
});
it("does not overwrite a user binding that is still being persisted", async () => {
  const { host, chosen } = await directories();
  const choice = workspaceManager.bind("choice", chosen);
  const restore = workspaceManager.bindIfUnbound("choice", host);
  await choice;
  expect(await restore).toBe(chosen);
});
it("preserves a later explicit user change after restoring the Host root", async () => {
  const { host, chosen } = await directories();
  const restore = workspaceManager.bindIfUnbound("later", host);
  const choice = workspaceManager.bind("later", chosen);
  expect(await restore).toBe(host); await choice;
  expect(workspaceManager.getForSession("later")).toBe(chosen);
});
it("a rejected path does not prevent the next valid binding", async () => {
  const { host } = await directories();
  await expect(workspaceManager.bindIfUnbound("retry", join(host, "missing"))).rejects.toThrow();
  expect(await workspaceManager.bindIfUnbound("retry", host)).toBe(host);
});

it("preserves the Host spelling for a symlink to the selected root, but keeps an explicitly different root", async () => {
  const { host, chosen } = await directories();
  const alias = join(roots.at(-1)!, "alias"); await symlink(host, alias, "dir");
  await workspaceManager.bindIfUnbound("alias", alias);
  expect(workspaceManager.getForSession("alias")).toBe(alias);
  expect(await workspaceManager.resolveRuntimeCwd("alias", alias)).toBe(alias);
  await workspaceManager.bind("alias", chosen);
  expect(await workspaceManager.resolveRuntimeCwd("alias", alias)).toBe(chosen);
});
