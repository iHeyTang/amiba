import type { Context } from "@deepseek-ai/cordis";
import { describe, expect, it, vi } from "vitest";
import { applyMemoryRemote } from "./remote-service.js";
import { AMIBA_MEMORY_REMOTE } from "./remote.js";
import { initialMemosStatus, type MemosStatus } from "./memos-status.js";

describe("MemOS status remote", () => {
  it("publishes engine status and read-only dashboard methods", () => {
    const provide = vi.fn();
    const ctx = { reflect: { provide } } as unknown as Context;
    const status = initialMemosStatus("/memory-test/memos");
    applyMemoryRemote(ctx, () => ({ ...status }));
    expect(provide).toHaveBeenCalledOnce();
    expect(provide.mock.calls[0]?.[0]).toBe("amibaMemory");
    const service = provide.mock.calls[0]?.[1] as { status(): MemosStatus };
    expect(service.status()).toEqual(status);
    status.state = "ready";
    expect(service.status().state).toBe("ready");
    for (const retired of ["list", "reset", "presets"])
      expect(retired in service).toBe(false);
    expect(AMIBA_MEMORY_REMOTE.descriptors.map((item) => item.method)).toEqual([
      "beginCorrection",
      "login",
      "overview",
      "browse",
      "detail",
      "update",
      "status",
    ]);
  });
});
