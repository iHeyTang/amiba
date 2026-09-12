import type { Context } from "@deepseek-ai/cordis";
import { apply as mountFilesystemSkills } from "@deepseek-ai/dsh-skill-filesystem";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export const bundledSkillsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../skills");

/** Use the official loader and bundled precedence; never copy into user skills. */
export function mountBundledSkills(ctx: Context): void {
  mountFilesystemSkills(ctx, {
    providerName: "amiba-bundled",
    includeDefaultRoots: false,
    bundledSkillDir: bundledSkillsRoot,
    watch: false,
  });
}
