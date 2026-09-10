import type { Config as UpstreamConfig } from "@memtensor/memos-local-plugin/dist/adapters/deepseek-harness/index.js";
import type { Context } from "@deepseek-ai/cordis";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MemosStatus } from "./memos-status.js";

export interface MemosOptions {
  memosRoot: string;
  viewerPort: number;
}

/** Only seed a NEW installation. User configuration survives every restart. */
export async function seedMemosConfig(configFile: string): Promise<void> {
  await mkdir(path.dirname(configFile), { recursive: true, mode: 0o700 });
  try {
    await writeFile(configFile, [
      "# Amiba defaults. Changes take effect after restarting Amiba.",
      "algorithm:",
      "  lightweightMemory:",
      "    enabled: false",
      "telemetry:",
      "  enabled: false",
      "logging:",
      "  llmLog:",
      "    redactPrompts: true",
      "    redactCompletions: true",
      "",
    ].join("\n"), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

/** Composition only: upstream owns capture, retrieval, tools, Core and Viewer. */
export async function mountMemos(
  ctx: Context,
  options: MemosOptions,
  status: MemosStatus,
): Promise<void> {
  try {
    if (!path.isAbsolute(options.memosRoot)) {
      throw new Error("MemOS data directory must be an absolute path.");
    }
    const [{ resolveHome, loadConfig }, upstream] = await Promise.all([
      import("@memtensor/memos-local-plugin/dist/core/config/index.js"),
      import("@memtensor/memos-local-plugin/dist/adapters/deepseek-harness/index.js"),
    ]);
    // Use the same resolver as upstream, including explicit MEMOS_* overrides.
    const home = resolveHome("deepseek-harness", options.memosRoot);
    status.home = home.root;
    await seedMemosConfig(home.configFile);
    const { config } = await loadConfig(home, "deepseek-harness");
    status.mode = config.algorithm.lightweightMemory.enabled ? "lightweight" : "full";
    ctx.plugin({
      name: upstream.name,
      inject: upstream.inject,
      Config: upstream.Config,
      async apply(child: Context, engineConfig: UpstreamConfig) {
        status.state = "starting";
        status.error = null;
        try {
          const dispose = await upstream.apply(child, engineConfig);
          status.state = "ready";
          status.viewerUrl = `http://127.0.0.1:${options.viewerPort}`;
          return async () => {
            status.state = "stopped";
            status.viewerUrl = null;
            await dispose();
          };
        } catch (error) {
          status.state = "error";
          status.viewerUrl = null;
          status.error = error instanceof Error ? error.message : String(error);
          child.logger.warn(`MemOS unavailable: ${status.error}`);
        }
      },
    }, {
      home: home.root,
      profileId: "standard",
      enabled: true,
      recallEnabled: true,
      captureEnabled: true,
      toolsEnabled: true,
      hostLlmEnabled: true,
      viewerEnabled: true,
      viewerPort: options.viewerPort,
      recallTimeoutMs: 3000,
      contextMaxChars: 6000,
      toolResultMaxChars: 1200,
      // Don't silently claim success if Core or Viewer failed to initialize.
      failOnStartupError: true,
    });
  } catch (error) {
    status.state = "error";
    status.error = error instanceof Error ? error.message : String(error);
    ctx.logger.warn(`MemOS unavailable: ${status.error}`);
  }
}
