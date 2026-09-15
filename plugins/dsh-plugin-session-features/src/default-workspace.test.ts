import { mkdtemp, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  ensureDefaultWorkspaceRoot,
  getDefaultWorkspaceRoot,
} from "./default-workspace.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function home() {
  const root = await mkdtemp(path.join(tmpdir(), "amiba-default-workspace-"));
  roots.push(root);
  return root;
}
it("resolves user-owned paths on macOS and Windows", () => {
  expect(getDefaultWorkspaceRoot("/Users/person", path.posix)).toBe(
    "/Users/person/Amiba/workspace",
  );
  expect(getDefaultWorkspaceRoot("D:\\Users\\person", path.win32)).toBe(
    "D:\\Users\\person\\Amiba\\workspace",
  );
});
it("creates a writable workspace concurrently without leaving probes or touching existing files", async () => {
  const root = await home();
  const workspace = await ensureDefaultWorkspaceRoot(root);
  await writeFile(path.join(workspace, "keep.txt"), "user data");
  expect(
    await Promise.all([
      ensureDefaultWorkspaceRoot(root),
      ensureDefaultWorkspaceRoot(root),
    ]),
  ).toEqual([workspace, workspace]);
  expect(await readdir(workspace)).toEqual(["keep.txt"]);
});
it("reports an unusable path without falling back to the user home", async () => {
  const root = await home();
  await mkdir(path.join(root, "Amiba"));
  await writeFile(path.join(root, "Amiba", "workspace"), "not a directory");
  await expect(ensureDefaultWorkspaceRoot(root)).rejects.toThrow(
    `Cannot use the default workspace ${getDefaultWorkspaceRoot(root)}`,
  );
});
