import fs from "node:fs/promises";
import path from "node:path";

export async function workspacePackages(workspaceDir) {
  const packages = new Map();
  for (const root of ["packages", "plugins", "bundles"]) {
    for (const entry of await fs.readdir(path.join(workspaceDir, root), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(workspaceDir, root, entry.name);
      let manifest;
      try {
        manifest = JSON.parse(
          await fs.readFile(path.join(directory, "package.json"), "utf8"),
        );
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      packages.set(manifest.name, { name: manifest.name, directory, manifest });
    }
  }
  return packages;
}

// Follow workspace dependencies, including transitive UI/SDK and plugin imports.
// This deliberately includes new files and tree-shaken imports: source maps alone
// cannot invalidate a module that was absent from the previous emitted bundle.
export function dependencyDirectories(name, packages, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const pkg = packages.get(name);
  if (!pkg) return [];
  return [
    pkg.directory,
    ...Object.keys({
      ...pkg.manifest.dependencies,
      ...pkg.manifest.devDependencies,
      ...pkg.manifest.peerDependencies,
      ...pkg.manifest.optionalDependencies,
    }).flatMap((dependency) =>
      dependencyDirectories(dependency, packages, seen),
    ),
  ];
}

export function contains(directory, file) {
  const relative = path.relative(directory, file);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
