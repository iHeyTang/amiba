import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialMemosStatus } from "./memos-status.js";
import { mountMemos, seedMemosConfig } from "./memos.js";

const upstream = vi.hoisted(() => ({ apply: vi.fn(), loadConfig: vi.fn() }));
vi.mock("@memtensor/memos-local-plugin/dist/adapters/deepseek-harness/index.js", () => ({
  name: "memos-local-memory", inject: ["systemPrompt", "tools", "llm"], Config: {}, apply: upstream.apply,
}));
vi.mock("@memtensor/memos-local-plugin/dist/core/config/index.js", () => ({
  resolveHome: (_agent: string, root: string) => ({ root, configFile: path.join(root, "config.yaml") }),
  loadConfig: upstream.loadConfig,
}));
const roots: string[] = [];
async function home() { const root = await mkdtemp(path.join(tmpdir(), "amiba-memos-test-")); roots.push(root); return root; }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); vi.clearAllMocks(); });

describe("MemOS built-in integration", () => {
  it("seeds full mode once and preserves the owner's model and mode settings", async () => {
    const file = path.join(await home(), "config.yaml");
    await seedMemosConfig(file);
    expect(await readFile(file, "utf8")).toContain("lightweightMemory:\n    enabled: false");
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
    const custom = "algorithm:\n  lightweightMemory:\n    enabled: true\nllm:\n  model: my-model\n";
    await writeFile(file, custom);
    await seedMemosConfig(file);
    expect(await readFile(file, "utf8")).toBe(custom);
  });

  it("composes the native upstream plugin and reflects its real lifecycle", async () => {
    const root = await home();
    const status = initialMemosStatus(root);
    const dispose = vi.fn().mockResolvedValue(undefined);
    upstream.apply.mockResolvedValue(dispose);
    upstream.loadConfig.mockResolvedValue({ config: { algorithm: { lightweightMemory: { enabled: true } } } });
    const plugin = vi.fn();
    const ctx = { plugin, logger: { warn: vi.fn() } } as unknown as Context;
    await mountMemos(ctx, { memosRoot: root, viewerPort: 18861 }, status);
    expect(status.state).toBe("starting");
    expect(status.mode).toBe("lightweight");
    const [native, config] = plugin.mock.calls[0]!;
    expect(native.name).toBe("memos-local-memory");
    expect(config).toMatchObject({ home: root, captureEnabled: true, recallEnabled: true, hostLlmEnabled: true, failOnStartupError: true });
    const cleanup = await native.apply(ctx, config);
    expect(upstream.apply).toHaveBeenCalledWith(ctx, config);
    expect(status.state).toBe("ready");
    expect(status.viewerUrl).toBe("http://127.0.0.1:18861");
    await cleanup();
    expect(dispose).toHaveBeenCalledOnce();
    expect(status.state).toBe("stopped");
    expect(status.viewerUrl).toBeNull();
  });

  it("surfaces native boot failures without a false healthy status", async () => {
    const root = await home();
    const status = initialMemosStatus(root);
    upstream.loadConfig.mockResolvedValue({ config: { algorithm: { lightweightMemory: { enabled: false } } } });
    upstream.apply.mockRejectedValue(new Error("viewer port is occupied"));
    const plugin = vi.fn();
    const ctx = { plugin, logger: { warn: vi.fn() } } as unknown as Context;
    await mountMemos(ctx, { memosRoot: root, viewerPort: 18861 }, status);
    const [native, config] = plugin.mock.calls[0]!;
    await native.apply(ctx, config);
    expect(status).toMatchObject({ state: "error", viewerUrl: null, error: "viewer port is occupied" });
  });
});
