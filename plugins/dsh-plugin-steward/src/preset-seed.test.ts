import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { STEWARD_PRESET, STEWARD_PRESET_ID, seedAgentPresets } from "./preset-seed.js";

describe("steward preset seed", () => {
  it("writes preset.yml and agent.cordis.yml once and never overwrites", async () => {
    const root = mkdtempSync(join(tmpdir(), "amiba-presets-"));
    const log = { warn: vi.fn(), info: vi.fn() };
    await seedAgentPresets(root, [STEWARD_PRESET], log);
    const dir = join(root, STEWARD_PRESET_ID);
    expect(readFileSync(join(dir, "preset.yml"), "utf8")).toContain("大管家");
    const composition = readFileSync(join(dir, "agent.cordis.yml"), "utf8");
    expect(composition).toContain("@deepseek-ai/dsh-persona");
    expect(composition).toContain("@deepseek-ai/dsh-tool-ask-user");
    expect(composition).toContain("steward_dispatch");
    expect(composition).not.toContain("dsh-tool-bash");

    writeFileSync(join(dir, "preset.yml"), "name: mine\n");
    await seedAgentPresets(root, [STEWARD_PRESET], log);
    expect(readFileSync(join(dir, "preset.yml"), "utf8")).toBe("name: mine\n");
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("warns instead of throwing when the root is unwritable", async () => {
    const root = mkdtempSync(join(tmpdir(), "amiba-presets-"));
    mkdirSync(join(root, "blocked"));
    writeFileSync(join(root, "blocked", STEWARD_PRESET_ID), "file, not a dir");
    const log = { warn: vi.fn() };
    await seedAgentPresets(join(root, "blocked", STEWARD_PRESET_ID), [STEWARD_PRESET], log);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("never writes when the existence check fails for a reason other than ENOENT", async () => {
    if (process.getuid?.() === 0) {
      // Running as root; chmod will not produce EACCES
      return;
    }

    const root = mkdtempSync(join(tmpdir(), "amiba-presets-"));
    try {
      mkdirSync(join(root, STEWARD_PRESET_ID));
      writeFileSync(join(root, STEWARD_PRESET_ID, "preset.yml"), "name: mine\n");
      chmodSync(root, 0o000);
      const log = { warn: vi.fn() };
      await seedAgentPresets(root, [STEWARD_PRESET], log);
      expect(log.warn).toHaveBeenCalledTimes(1);
      chmodSync(root, 0o700);
      expect(readFileSync(join(root, STEWARD_PRESET_ID, "preset.yml"), "utf8")).toBe("name: mine\n");
    } finally {
      chmodSync(root, 0o700);
    }
  });
});
