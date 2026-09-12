import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import chokidar from "chokidar";
import {
  contains,
  dependencyDirectories,
  workspacePackages,
} from "./dsh-client-dependencies.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
export async function watchClients({
  workspaceDir = path.resolve(scriptsDir, "../../.."),
  fullPlugins = process.env.AMIBA_DSH_DEV_PROJECTS !== undefined,
  runtimeDir = path.resolve(
    process.env.AMIBA_DSH_RUNTIME_DIR?.trim() ||
      path.join(workspaceDir, "packages/app-runtime/resources/dsh-runtime"),
  ),
} = {}) {
  workspaceDir = await fsp.realpath(workspaceDir);
  let packages = await workspacePackages(workspaceDir);
  const plugins = [...packages.values()]
    .filter((pkg) => fullPlugins
      ? pkg.directory.startsWith(path.join(workspaceDir, "plugins") + path.sep)
      : pkg.manifest.dsh?.client && pkg.name.startsWith("@amiba/"))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const plugin of plugins) {
    plugin.installedLib = fullPlugins ? path.join(plugin.directory, "lib") : path.join(
      runtimeDir,
      "app/node_modules",
      plugin.name,
      "lib",
    );
    if (!fs.existsSync(path.join(plugin.installedLib, plugin.manifest.dsh?.client ? "client.js" : "index.js"))) {
      throw new Error(
        `managed runtime is missing ${plugin.name}; run pnpm runtime:prepare`,
      );
    }
    plugin.dependencies = dependencyDirectories(plugin.name, packages);
    plugin.inputs = await readInputs(plugin);
  }

  async function readInputs(plugin) {
    try {
      const metadata = JSON.parse(
        await fsp.readFile(
          path.join(plugin.installedLib, ".client-inputs.json"),
          "utf8",
        ),
      );
      if (
        metadata.version === 1 &&
        metadata.workspaceDir === workspaceDir &&
        Array.isArray(metadata.files)
      )
        return new Set(metadata.files);
    } catch {
      /* Older runtimes safely fall back to the workspace dependency graph. */
    }
    return undefined;
  }

  const pending = new Set();
  let timer;
  let child;
  let closing = false;
  let draining = false;
  const roots = [...new Set(plugins.flatMap((plugin) => plugin.dependencies))];
  const watchPaths = roots.flatMap((root) => [
    path.join(root, "src"),
    ...[
      "package.json",
      "tsconfig*.json",
      "vite*.config.*",
      "tailwind.config.*",
      "postcss.config.*",
      "scripts",
    ].map((file) => path.join(root, file)),
  ]);
  const globalInputs = [
    "scripts/dsh-client-inputs.mjs",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.json",
    "tsconfig.dsh-plugin.json",
  ].map((file) => path.join(workspaceDir, file));
  const watcher = chokidar.watch(
    [
      ...watchPaths,
      ...globalInputs,
      ...plugins.flatMap((plugin) => [...(plugin.inputs || [])]),
    ],
    {
      ignoreInitial: true,
      ignored:
        /(^|[/\\])(?:node_modules|lib|dist|out|\.git|\.cache|\.amiba-build-[^/\\]+|\.client-build-[^/\\]+)([/\\]|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|\.tsbuildinfo$/,
      awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
    },
  );

  // Compile outside the serving directory. Failed builds never replace working
  // bundles. Publish maps/assets first and client.js last, which is DSH's HMR trigger.
  async function compile(plugin) {
    if (fullPlugins) {
      const code = await new Promise((resolve, reject) => {
        child = spawn(process.execPath, [path.join(scriptsDir, "build-dsh-plugin.mjs"), plugin.directory], { cwd: workspaceDir, stdio: "inherit" });
        child.once("error", reject);
        child.once("exit", resolve);
      });
      child = undefined;
      if (code !== 0) console.error(`[desktop:hmr] build failed for ${plugin.name}; keeping previous output`);
      else console.log(`[desktop:hmr] updated ${plugin.name} (host/client/native)`);
      return;
    }
    const stage = await fsp.mkdtemp(
      path.join(plugin.directory, ".client-build-"),
    );
    const started = performance.now();
    try {
      const code = await new Promise((resolve, reject) => {
        child = spawn(
          process.execPath,
          [
            path.join(scriptsDir, "build-dsh-client.mjs"),
            plugin.directory,
            stage,
          ],
          {
            cwd: workspaceDir,
            stdio: "inherit",
          },
        );
        child.once("error", reject);
        child.once("exit", resolve);
      });
      child = undefined;
      if (code !== 0) {
        // A failed new import may not be in the previous dependency snapshot.
        plugin.inputs = undefined;
        return;
      }
      if (closing) return;
      const files = await fsp.readdir(stage, { recursive: true });
      files.sort(
        (a, b) => Number(a === "client.js") - Number(b === "client.js"),
      );
      for (const relative of files) {
        const source = path.join(stage, relative);
        if (!(await fsp.stat(source)).isFile()) continue;
        const target = path.join(plugin.installedLib, relative);
        await fsp.mkdir(path.dirname(target), { recursive: true });
        const temporary = `${target}.pending`;
        await fsp.copyFile(source, temporary);
        await fsp.rename(temporary, target);
      }
      plugin.inputs = await readInputs(plugin);
      if (plugin.inputs) watcher.add([...plugin.inputs]);
      console.log(
        `[desktop:hmr] updated ${plugin.name} (${Math.round(performance.now() - started)}ms)`,
      );
    } finally {
      child = undefined;
      await fsp.rm(stage, { recursive: true, force: true });
    }
  }

  async function drain() {
    if (draining || closing) return;
    draining = true;
    try {
      while (pending.size && !closing) {
        const plugin = pending.values().next().value;
        pending.delete(plugin);
        try {
          await compile(plugin);
        } catch (error) {
          console.error(`[desktop:hmr] ${plugin.name}: ${error.message}`);
        }
      }
    } finally {
      draining = false;
    }
  }
  let events = Promise.resolve();
  watcher.on("all", (_event, file) => {
    if (file.includes(`${path.sep}.client-build-`) || file.includes(".timestamp-")) return;
    events = events
      .then(async () => {
        const manifestChanged = path.basename(file) === "package.json";
        if (manifestChanged) {
          packages = await workspacePackages(workspaceDir);
          for (const plugin of plugins) {
            plugin.dependencies = dependencyDirectories(plugin.name, packages);
            // Dependency declarations can introduce new source roots.
            watcher.add(
              plugin.dependencies.map((root) => path.join(root, "src")),
            );
          }
          console.log(
            "[desktop:hmr] package manifest changed; restart desktop to apply host/dependency changes",
          );
        }
        for (const plugin of plugins) {
          const affected =
            globalInputs.includes(file) ||
            contains(plugin.directory, file) ||
            (!fullPlugins && plugin.inputs && !manifestChanged
              ? plugin.inputs.has(file)
              : plugin.dependencies.some((directory) =>
                  contains(directory, file),
                ));
          if (affected) pending.add(plugin);
        }
        clearTimeout(timer);
        timer = setTimeout(() => void drain(), 100);
      })
      .catch((error) => console.error(`[desktop:hmr] ${error.message}`));
  });
  watcher.on("error", (error) => {
    console.error(`[desktop:hmr] ${error.message}`);
    void stop(1);
  });
  watcher.once("ready", () => {
    // runtime:prepare has already verified the source digest and all artifacts.
    // Register watches before announcing readiness; no redundant initial builds.
    console.log(
      `[desktop:hmr] watching ${plugins.length} ${fullPlugins ? "workspace plugins (host/client/native)" : "workspace client plugins"} (on-demand builds)`,
    );
  });
  async function stop(code) {
    if (closing) return;
    closing = true;
    clearTimeout(timer);
    pending.clear();
    await watcher.close();
    if (child) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await exited;
    }
    // Let compile's finally clean up its staging directory before exiting.
    process.exitCode = code;
  }
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => void stop(0));

  return { stop };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await watchClients();
}
