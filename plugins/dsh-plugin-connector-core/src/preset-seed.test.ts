import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RESTRICTED_PRESET, seedAgentPresets } from "./preset-seed.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "amiba-agent-preset-seed-"));
  roots.push(root);
  return root;
}

function fakeLog() {
  return { info: vi.fn(), warn: vi.fn() };
}

// Forbidden and required substrings enforced structurally against the raw
// composition text: this package has no YAML parser dependency, so rather
// than parse the document these assertions match the letter of the task's
// contract — every capability the restricted preset must NOT grant is
// absent, and every capability it must keep is present — directly against
// the file content the seeder writes to disk.
const FORBIDDEN_TOKENS = [
  "tool-bash",
  "tool-pwsh",
  "tool-fs",
  "tool-jobs",
  "tool-subagent",
  "tool-workflow",
  "tool-ralph",
];
const REQUIRED_TOKENS = ["tool-ask-user", "tool-todo", "tool-web"];

describe("RESTRICTED_PRESET composition", () => {
  it("agent.cordis.yml starts with a top-level YAML list item", () => {
    expect(RESTRICTED_PRESET.files["agent.cordis.yml"]!.trimStart()).toMatch(/^#/);
    // The first non-comment, non-blank line must open the top-level list.
    const firstListLine = RESTRICTED_PRESET.files["agent.cordis.yml"]!
      .split("\n")
      .find((line) => line.trim() && !line.trim().startsWith("#"));
    expect(firstListLine).toMatch(/^- id:/);
  });

  it("excludes every forbidden capability token", () => {
    const content = RESTRICTED_PRESET.files["agent.cordis.yml"]!;
    for (const token of FORBIDDEN_TOKENS) expect(content).not.toContain(token);
  });

  it("keeps every required safe-capability token", () => {
    const content = RESTRICTED_PRESET.files["agent.cordis.yml"]!;
    for (const token of REQUIRED_TOKENS) expect(content).toContain(token);
  });

  it("keeps tool-web's exact standard config (fetch disabled)", () => {
    const content = RESTRICTED_PRESET.files["agent.cordis.yml"]!;
    expect(content).toMatch(/id:\s*tool-web[\s\S]*?fetch:\s*false/);
  });

  it("has a preset.yml with name/description/order metadata", () => {
    const content = RESTRICTED_PRESET.files["preset.yml"]!;
    expect(content).toMatch(/^name:/m);
    expect(content).toMatch(/^description:/m);
    expect(content).toMatch(/^order:\s*10\s*$/m);
  });

  it("uses id \"restricted\"", () => {
    expect(RESTRICTED_PRESET.id).toBe("restricted");
  });
});

describe("seedAgentPresets", () => {
  it("seeds a fresh root: creates the preset directory and writes its files", async () => {
    const root = await tempRoot();
    const log = fakeLog();

    await seedAgentPresets(root, [RESTRICTED_PRESET], log);

    const dir = join(root, "restricted");
    const cordisContent = await readFile(join(dir, "agent.cordis.yml"), "utf8");
    const presetContent = await readFile(join(dir, "preset.yml"), "utf8");
    expect(cordisContent).toBe(RESTRICTED_PRESET.files["agent.cordis.yml"]);
    expect(presetContent).toBe(RESTRICTED_PRESET.files["preset.yml"]);

    // Logs one info line naming the seeded preset and its root.
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.info.mock.calls[0]![0]).toContain("restricted");
    expect(log.info.mock.calls[0]![0]).toContain(root);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("never overwrites an existing preset directory, even with modified content", async () => {
    const root = await tempRoot();
    const dir = join(root, "restricted");
    await mkdir(dir, { recursive: true });
    const userContent = "# this is the user's own, deliberately different, composition\n";
    await writeFile(join(dir, "agent.cordis.yml"), userContent, "utf8");
    const log = fakeLog();

    await seedAgentPresets(root, [RESTRICTED_PRESET], log);

    const afterContent = await readFile(join(dir, "agent.cordis.yml"), "utf8");
    expect(afterContent).toBe(userContent);
    // No preset.yml was ever written by the seeder either — the directory's
    // existence alone is enough to skip, byte for byte, nothing added.
    await expect(stat(join(dir, "preset.yml"))).rejects.toMatchObject({ code: "ENOENT" });
    // Skipped silently: no info/warn line for a directory that already exists.
    expect(log.info).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("skips a preset directory that exists in any other form (e.g. an empty file, not a directory)", async () => {
    const root = await tempRoot();
    const dir = join(root, "restricted");
    // "Exists in any form" — a bare file at the preset's path, not a directory.
    await writeFile(dir, "not a directory", "utf8");
    const log = fakeLog();

    await seedAgentPresets(root, [RESTRICTED_PRESET], log);

    const stillFile = await stat(dir);
    expect(stillFile.isFile()).toBe(true);
    expect(await readFile(dir, "utf8")).toBe("not a directory");
    expect(log.info).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("warns and does not throw when the root itself is unusable (a file, not a directory)", async () => {
    const root = await tempRoot();
    // Replace the temp directory's role: point `root` at a path that is a
    // plain file, so `join(root, id)` can never be created as a directory.
    const fileAsRoot = join(root, "not-a-directory");
    await writeFile(fileAsRoot, "i am a file", "utf8");
    const log = fakeLog();

    await expect(
      seedAgentPresets(fileAsRoot, [RESTRICTED_PRESET], log),
    ).resolves.toBeUndefined();

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]![0]).toContain("restricted");
    expect(log.info).not.toHaveBeenCalled();
  });

  it("continues seeding remaining seeds after one seed fails", async () => {
    const root = await tempRoot();
    const log = fakeLog();
    const okSeed = { id: "ok-preset", files: { "preset.yml": "name: ok\n" } };
    // A seed whose id contains a path separator cannot be created as a
    // single directory segment reliably across platforms in every case, but
    // to keep this deterministic we instead force failure by pre-occupying
    // a distinct root with a file where a *different* seed's directory
    // would go, then assert the healthy seed still lands.
    const brokenDir = join(root, "broken-preset");
    await writeFile(brokenDir, "occupying this path as a file first is not enough to fail seeding, so nest one level deeper", "utf8");
    const brokenSeed = {
      id: "broken-preset/nested",
      files: { "agent.cordis.yml": "# unreachable\n" },
    };

    await seedAgentPresets(root, [brokenSeed, okSeed], log);

    expect(log.warn).toHaveBeenCalledTimes(1);
    const okContent = await readFile(join(root, "ok-preset", "preset.yml"), "utf8");
    expect(okContent).toBe("name: ok\n");
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.info.mock.calls[0]![0]).toContain("ok-preset");
  });

  it("does not require log.info to be present", async () => {
    const root = await tempRoot();
    const warn = vi.fn();

    await expect(
      seedAgentPresets(root, [RESTRICTED_PRESET], { warn }),
    ).resolves.toBeUndefined();

    expect(warn).not.toHaveBeenCalled();
    const content = await readFile(join(root, "restricted", "agent.cordis.yml"), "utf8");
    expect(content).toBe(RESTRICTED_PRESET.files["agent.cordis.yml"]);
  });
});
