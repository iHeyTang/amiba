import { expect, it, vi } from "vitest";
import type { WorkspaceFilesAdapter } from "@amiba/app-runtime/platform";
import { makeWorkspaceFilesProvider } from "../workspace-files-provider";

it("keeps retained providers addressed to their own workspace across another session's searches", async () => {
  const search = vi.fn(async (_id: string, _query: string) => [{ path: "src/文档.ts" }]);
  const files = { search } as unknown as WorkspaceFilesAdapter;
  const background = makeWorkspaceFilesProvider(files, "background");
  const foreground = makeWorkspaceFilesProvider(files, "foreground");
  const items = await background.search("first");
  await foreground.search("current");
  await background.search("retained");
  expect(search.mock.calls).toEqual([["background", "first"], ["foreground", "current"], ["background", "retained"]]);
  expect(items).toMatchObject([{ label: "文档.ts", description: "src/文档.ts", insert: { type: "file", payload: { path: "src/文档.ts" } } }]);
  expect(background.serialize!(items[0].insert!)).toBe("src/文档.ts");
});

it("preserves the explicit live callback API for existing embedders", async () => {
  let selected = "one";
  const search = vi.fn(async (_id: string, _query: string) => []);
  const provider = makeWorkspaceFilesProvider({ search } as unknown as WorkspaceFilesAdapter, () => selected);
  await provider.search("first");
  selected = "two";
  await provider.search("next");
  expect(search.mock.calls).toEqual([["one", "first"], ["two", "next"]]);
});
