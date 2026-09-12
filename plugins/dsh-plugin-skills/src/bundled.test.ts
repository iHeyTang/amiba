import { Context } from "@deepseek-ai/cordis";
import { SkillRegistry } from "@deepseek-ai/dsh-skill";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { bundledSkillsRoot, mountBundledSkills } from "./bundled.js";

it("discovers the packaged creator through DSH as bundled with readable resources", async () => {
  const ctx = new Context();
  const registry = ctx.plugin(SkillRegistry);
  await registry;
  const bundled = ctx.plugin({ name: "amiba-bundled-test", inject: ["skills"], apply: mountBundledSkills });
  await bundled;
  try {
    const skill = await ctx.skills.get("skill-creator");
    expect(skill).toMatchObject({
      source: "bundled", provider: "amiba-bundled",
      invocation: { modelInvocable: true, userInvocable: true },
      resourceBase: { kind: "directory", path: join(bundledSkillsRoot, "skill-creator") },
    });
    for (const relative of ["references/amiba-connectors.md", "references/upstream-skill-creator.md", "scripts/validate_dsh.mjs", "scripts/init_skill.py", "license.txt", "NOTICE"])
      expect((await readFile(join(bundledSkillsRoot, "skill-creator", relative), "utf8")).length).toBeGreaterThan(0);
    await bundled.dispose();
    expect(await ctx.skills.get("skill-creator")).toBeUndefined();
  } finally { await bundled.dispose(); await registry.dispose(); }
});

it("the shipped validator rejects the connector YAML regression using the real loader", async () => {
  const root = await mkdtemp(join(tmpdir(), "amiba-validate-skill-"));
  const directory = join(root, "sample");
  await mkdir(directory);
  const script = join(bundledSkillsRoot, "skill-creator/scripts/validate_dsh.mjs");
  const run = () => promisify(execFile)(process.execPath, [script, directory]);
  try {
    await writeFile(join(directory, "SKILL.md"), '---\nname: sample\ndescription: CLI (provider: lark)\n---\n\nUse the CLI.\n');
    await expect(run()).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("invalid YAML frontmatter") });
    await writeFile(join(directory, "SKILL.md"), '---\nname: sample\ndescription: "CLI (provider: lark)"\nuser-invocable: false\n---\n\nUse the CLI.\n');
    expect(JSON.parse((await run()).stdout)).toMatchObject({ name: "sample", invocation: { userInvocable: false, modelInvocable: true } });
  } finally { await rm(root, { recursive: true, force: true }); }
});
