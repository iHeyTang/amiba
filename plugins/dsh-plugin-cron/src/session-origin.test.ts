import { describe, expect, it, vi } from "vitest";
import { cronSessionOrigin } from "./session-origin.js";
import { CronService } from "./service.js";

const message = (rpcId: string) => ({ type: "user/message", data: { source: { kind: "user", rpcId } } });
const cron = message("cron:cron_ab12:abc-123");

describe("cron session provenance", () => {
  it("closes failed reads and retries classification on the next refresh", async () => {
    const close = vi.fn(async () => {});
    const read = vi.fn()
      .mockRejectedValueOnce(new Error("temporarily unavailable"))
      .mockResolvedValue({ events: [cron] });
    const open = vi.fn(async () => ({ read, close }));
    const service = new CronService({ sessionPersistence: { open } } as never, {} as never);
    expect(await service.sessionIds(["retry"])).toEqual([]);
    expect(close).toHaveBeenCalledTimes(1);
    expect(await service.sessionIds(["retry"])).toEqual(["retry"]);
    expect(close).toHaveBeenCalledTimes(2);
    service.dispose();
  });

  it("recognizes persisted cron origins without task definitions or title matching", () => {
    expect(cronSessionOrigin([cron, message("desktop:123")])).toBe(true);
    expect(cronSessionOrigin([message("desktop:123"), cron])).toBe(false);
    expect(cronSessionOrigin([message("schedule:cron_ab12:abc-123")])).toBe(false);
    expect(cronSessionOrigin([])).toBeUndefined();
  });

  it("finds all old runs, caches settled origins and retries blank or unreadable sessions", async () => {
    const logs: Record<string, ReturnType<typeof message>[]> = { old: [cron], newer: [cron], ordinary: [message("desktop:123")], blank: [] };
    const close = vi.fn(async () => {});
    const open = vi.fn(async (id: string) => {
      if (!logs[id]) throw new Error("not persisted yet");
      return { read: async () => ({ events: logs[id] }), close };
    });
    const service = new CronService({ sessionPersistence: { open } } as never, {} as never);
    const ids = ["old", "newer", "ordinary", "blank", "missing"];
    expect(await service.sessionIds(ids)).toEqual(["old", "newer"]);
    expect(open).toHaveBeenCalledWith("old", "read");
    expect(close).toHaveBeenCalledTimes(4);
    open.mockClear();
    logs.blank = [cron];
    logs.missing = [cron];
    expect(await service.sessionIds(ids)).toEqual(["old", "newer", "blank", "missing"]);
    expect(open.mock.calls.map(([id]) => id)).toEqual(["blank", "missing"]);
    service.dispose();
  });
});
