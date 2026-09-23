import { beforeEach, expect, it, vi } from "vitest";
import { setPlatform, type PlatformAdapter } from "@amiba/app-runtime/platform";
import { prepareHomeSession, consumeHomeSession } from "./prepared-session";

let rows: any[];
const create = vi.fn(async ({ cwd, agentPreset }) => {
  const sessionId = `session-${rows.length}`;
  rows.push({ sessionId, cwd, agentPreset, blank: true, running: false });
  return { sessionId };
});
const select = vi.fn(async (id, preset) => { rows.find(row => row.sessionId === id).agentPreset = preset; });
const bind = vi.fn(async () => {});
const selectModel = vi.fn(async () => ({}));
beforeEach(() => {
  vi.clearAllMocks(); rows = [];
  setPlatform({ agentSessions: { list: async () => rows, create },
    agentPresets: { select }, workspaces: { bind },
    agentModels: { directory: async () => ({ routable: true, current: { provider: 'p', model: 'm' } }), select: selectModel },
  } as unknown as PlatformAdapter);
});
it("serializes concurrent preparation and preset changes without creating duplicates", async () => {
  const ids = await Promise.all([prepareHomeSession('/a', 'one'), prepareHomeSession('/a', 'two'), prepareHomeSession('/a', 'three')]);
  expect(new Set(ids).size).toBe(1);
  expect(create).toHaveBeenCalledOnce();
  expect(rows[0].agentPreset).toBe('three');
});
it("keeps separate workspace sessions and copies the selected model on workspace changes", async () => {
  const a = await prepareHomeSession('/a');
  const b = await prepareHomeSession('/b', undefined, a);
  expect(a).not.toBe(b);
  expect(selectModel).toHaveBeenCalledWith(b, { provider: 'p', model: 'm' });
  expect(await prepareHomeSession('/a')).toBe(a);
});
it("never reuses a consumed, running, or nonblank session", async () => {
  const a = await prepareHomeSession('/a'); consumeHomeSession(a);
  const b = await prepareHomeSession('/a'); expect(b).not.toBe(a);
  rows.find(row => row.sessionId === b).running = true;
  const c = await prepareHomeSession('/a'); expect(c).not.toBe(b);
  rows.find(row => row.sessionId === c).blank = false;
  expect(await prepareHomeSession('/a')).not.toBe(c);
});
it("retries failed workspace binding on the same real session", async () => {
  bind.mockRejectedValueOnce(new Error('offline'));
  await expect(prepareHomeSession('/a')).rejects.toThrow('offline');
  await expect(prepareHomeSession('/a')).resolves.toBe('session-0');
  expect(create).toHaveBeenCalledOnce(); expect(bind).toHaveBeenCalledTimes(2);
});
it("a failed creation does not poison queued retries", async () => {
  create.mockRejectedValueOnce(new Error('offline'));
  const first = prepareHomeSession('/a');
  const retry = prepareHomeSession('/a');
  await expect(first).rejects.toThrow('offline');
  await expect(retry).resolves.toBe('session-0');
});
it("reuses its own blank session when the host canonicalizes the workspace path", async () => {
  const id = await prepareHomeSession('/tmp/project');
  rows[0].cwd = '/private/tmp/project';
  expect(await prepareHomeSession('/tmp/project')).toBe(id);
  expect(create).toHaveBeenCalledOnce();
});
