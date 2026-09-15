import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/** User-visible task files, kept separate from application settings and caches. */
export function getDefaultWorkspaceRoot(
  home = homedir(),
  paths: Pick<typeof path, "join"> = path,
): string {
  return paths.join(home, "Amiba", "workspace");
}

/** Verify actual writes rather than relying on permission bits alone. */
export async function ensureDefaultWorkspaceRoot(
  home = homedir(),
): Promise<string> {
  const root = getDefaultWorkspaceRoot(home);
  let probe: string | undefined;
  try {
    await mkdir(root, { recursive: true });
    probe = await mkdtemp(path.join(root, ".amiba-write-check-"));
    await writeFile(path.join(probe, "probe"), "", { flag: "wx" });
    await rm(probe, { recursive: true });
    probe = undefined;
    return root;
  } catch (cause) {
    throw new Error(
      `Cannot use the default workspace ${root}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  } finally {
    if (probe)
      await rm(probe, { recursive: true, force: true }).catch(() => {});
  }
}
