import { describe, expect, it, vi } from "vitest";
import { cronSessionOrigin } from "./session-origin.js";
import { CronService } from "./service.js";

const message = (rpcId: string) => ({ type: "user/message", data: { source: { kind: "user", rpcId } } });
const cron = message("cron:cron_ab12:abc-123");

describe("cron session provenance", () => {
  it("recognizes persisted cron origins without task definitions or title matching", () => {
    expect(cronSessionOrigin([cron, message("desktop:123")])).toBe(true);
    expect(cronSessionOrigin([message("desktop:123"), cron])).toBe(false);
    expect(cronSessionOrigin([message("schedule:cron_ab12:abc-123")])).toBe(false);
    expect(cronSessionOrigin([])).toBeUndefined();
  });

  it("finds all old runs, caches settled origins and retries blank or unreadable sessions", async () => {
    const logs: Record<string, ReturnType<typeof message>[]> = { old: [cron], newer: [cron], ordinary: [message("desktop:123")], blank: [] };
    const inspect = vi.fn(async (id: string) => {
      if (!logs[id]) throw new Error("not persisted yet");
      return { events: logs[id] };
    });
    const service = new CronService({ sessionPersistence: { inspect } } as never, {} as never);
    const ids = ["old", "newer", "ordinary", "blank", "missing"];
    expect(await service.sessionIds(ids)).toEqual(["old", "newer"]);
    inspect.mockClear();
    logs.blank = [cron];
    logs.missing = [cron];
    expect(await service.sessionIds(ids)).toEqual(["old", "newer", "blank", "missing"]);
    expect(inspect.mock.calls.map(([id]) => id)).toEqual(["blank", "missing"]);
    service.dispose();
  });
});
