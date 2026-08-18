import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Context } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AmibaSkillStore } from "./skill-store.js";

const temporaryRoots: string[] = [];

async function createStore(): Promise<AmibaSkillStore> {
  const root = await mkdtemp(join(tmpdir(), "amiba-dsh-skills-"));
  temporaryRoots.push(root);
  const context = {
    emit: () => undefined,
    root: { emit: () => undefined },
    fs: {
      resolve: async (path: string) => ({ targetKey: path, displayPath: path }),
      stat: async (target: { displayPath: string }) => {
        const info = await stat(target.displayPath);
        return { type: "file", size: info.size, version: "test-version" };
      },
    },
    skills: {
      get: async (name: string) => ({
        name,
        description: "Draft release notes.",
        invocation: { modelInvocable: true, userInvocable: true },
        source: "user-dsh",
        provider: "filesystem:user-dsh",
        resourceBase: { kind: "directory", path: join(root, name) },
        content: "# Release notes",
      }),
    },
  } as unknown as Context;
  return new AmibaSkillStore(context, root);
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("AmibaSkillStore", () => {
  it("persists a normalized official DSH skill document atomically", async () => {
    const store = await createStore();
    const document = [
      "---\r",
      "name: release-notes\r",
      "description: Draft release notes.\r",
      "---\r",
      "\r",
      "# Release notes\r",
    ].join("\n");

    await expect(store.save(" release-notes ", document)).resolves.toEqual({
      name: "release-notes",
    });

    const saved = await store.read("release-notes");
    expect(saved.document).toBe(
      "---\nname: release-notes\ndescription: Draft release notes.\n---\n\n# Release notes\n",
    );
    await expect(
      readFile(join(store.userRoot, "release-notes", "SKILL.md"), "utf8"),
    ).resolves.toBe(saved.document);
  });

  it("projects the official DSH source, provider, resource base, and both invocation policies", async () => {
    const root = await mkdtemp(join(tmpdir(), "amiba-dsh-skills-projection-"));
    const projectRoot = join(root, "project-skill");
    temporaryRoots.push(root);
    const definition = {
      name: "project-skill",
      description: "Project workflow.",
      whenToUse: "Use in this workspace.",
      invocation: { modelInvocable: true, userInvocable: false },
      source: "project-dsh",
      provider: "filesystem:project-dsh",
      resourceBase: { kind: "directory" as const, path: projectRoot },
      content: "# Project workflow",
    };
    const context = {
      skills: {
        list: async () => [definition],
        get: async () => definition,
      },
    } as unknown as Context;
    const store = new AmibaSkillStore(context, join(root, "user"));

    await expect(store.list(null)).resolves.toMatchObject({
      skills: [
        {
          name: "project-skill",
          source: "project-dsh",
          provider: "filesystem:project-dsh",
          modelInvocable: true,
          userInvocable: false,
          editable: false,
          resourceBase: { kind: "directory", path: projectRoot },
        },
      ],
    });
  });

  it("reads a cold session through its DSH preset standing scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "amiba-dsh-skills-cold-"));
    temporaryRoots.push(root);
    const standingScope = { agentPreset: "standard" };
    const list = vi.fn(async (_options?: unknown) => []);
    const context = {
      agents: { get: () => undefined },
      sessions: { get: () => undefined },
      get: (name: string) => {
        if (name === "sessionPersistence") {
          return {
            inspect: async () => ({
              meta: {
                id: "cold-session",
                version: 1,
                cwd: root,
                agentPreset: "standard",
              },
              events: [],
            }),
          };
        }
        if (name === "agentPresets") {
          return {
            standingKeyFor: async () => standingScope,
          };
        }
        return undefined;
      },
      skills: { list },
    } as unknown as Context;
    const store = new AmibaSkillStore(context, join(root, "user"));

    await store.list("cold-session");

    expect(list).toHaveBeenCalledWith({
      cwd: root,
      scope: standingScope,
    });
  });

  it("lists and reads only regular files inside the DSH provider root", async () => {
    const root = await mkdtemp(join(tmpdir(), "amiba-dsh-skills-files-"));
    const providerRoot = join(root, "provider-skill");
    temporaryRoots.push(root);
    await mkdir(join(providerRoot, "references"), { recursive: true });
    await writeFile(join(providerRoot, "SKILL.md"), "# Provider skill\n", "utf8");
    await writeFile(join(providerRoot, "references", "guide.md"), "Guide\n", "utf8");
    await symlink(join(root, "outside.md"), join(providerRoot, "outside-link.md"));
    const definition = {
      name: "provider-skill",
      description: "Provider skill.",
      invocation: { modelInvocable: true, userInvocable: true },
      source: "custom",
      provider: "test-provider",
      resourceBase: { kind: "directory" as const, path: providerRoot },
      content: "# Provider skill",
    };
    const context = {
      skills: { get: async () => definition },
    } as unknown as Context;
    const store = new AmibaSkillStore(context, join(root, "user"));

    await expect(store.listFiles("provider-skill", null)).resolves.toMatchObject({
      root: await realpath(providerRoot),
      files: [
        { path: "references/guide.md", size: 6 },
        { path: "SKILL.md", size: 17 },
      ],
      truncated: false,
    });
    await expect(
      store.readFile("provider-skill", "references/guide.md", null),
    ).resolves.toMatchObject({ encoding: "utf-8", content: "Guide\n" });
    await expect(
      store.readFile("provider-skill", "../outside.md", null),
    ).rejects.toThrow("safe relative paths");
    await expect(
      store.readFile("provider-skill", "outside-link.md", null),
    ).rejects.toThrow("Symbolic links");
  });

  it("rejects invalid names and mismatched frontmatter", async () => {
    const store = await createStore();

    await expect(
      store.save(
        "Release Notes",
        "---\nname: Release Notes\ndescription: Invalid.\n---\n\n# Invalid\n",
      ),
    ).rejects.toThrow("lowercase kebab-case");
    await expect(
      store.save(
        "release-notes",
        "---\nname: another-skill\ndescription: Invalid.\n---\n\n# Invalid\n",
      ),
    ).rejects.toThrow('must be "release-notes"');
  });

  it("removes only the requested user-authored skill directory", async () => {
    const store = await createStore();
    await store.save(
      "release-notes",
      "---\nname: release-notes\ndescription: Draft release notes.\n---\n\n# Release notes\n",
    );

    await expect(store.remove("release-notes")).resolves.toEqual({
      name: "release-notes",
      deleted: true,
    });
    await expect(store.read("release-notes")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
