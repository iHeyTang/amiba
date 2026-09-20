import { beforeEach, describe, expect, it, vi } from "vitest";

type Summary = {
  sessionId: string;
  updatedAt: number;
  running: boolean;
  blank: boolean;
  title?: string;
  agentPreset?: string;
  origin?: "subagent";
  parentSessionId?: string;
};

const mocks = vi.hoisted(() => ({
  storage: {} as Record<string, unknown>,
  summaries: [] as Summary[],
  archived: [] as string[],
  set: vi.fn(),
  removed: [] as string[],
  archiveSession: vi.fn(),
  history: vi.fn(async () => ({ events: [] as Array<{ event: { type: string; seq: number; time: number; data: Record<string, unknown> } }>, hasMore: false })),
}));

vi.mock("@amiba/app-runtime/platform", () => ({
  getPlatform: () => ({
    storage: {
      get: async (keys: string | string[]) => {
        const selected = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(
          selected.map((key) => [key, mocks.storage[key]]),
        );
      },
      set: async (patch: Record<string, unknown>) => {
        mocks.set(patch);
        Object.assign(mocks.storage, patch);
      },
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          mocks.removed.push(key);
          delete mocks.storage[key];
        }
      },
      watch: () => () => {},
    },
    agentSessions: {
      list: async () => mocks.summaries,
      search: async () => [],
      create: async () => ({ sessionId: "new" }),
      history: mocks.history,
      rename: async () => ({ title: "", seq: 0 }),
      fork: async () => ({ sessionId: "child" }),
    },
    agentWorkspaces: {
      list: async () => ({ items: [], archivedSessionIds: mocks.archived }),
      archiveSession: mocks.archiveSession,
    },
  }),
}));

import { archiveSession, loadIndex, loadSessionMeta, loadMessages } from "./store";

it("retains the same direct-parent address for every child history page", async () => {
  const address = { parentSessionId: "parent", childSessionId: "child", mode: "one-shot" as const };
  mocks.history.mockClear();
  mocks.history.mockResolvedValueOnce({
    events: [{ event: { type: "session/created", seq: 20, time: 1, data: {} } }],
    hasMore: true,
  }).mockResolvedValueOnce({ events: [], hasMore: false });
  await loadMessages("child", address);
  // Assert the paging contract shape with the current page size
  // (`SESSION_HISTORY_PAGE_SIZE` in store.ts, not exported).
  const pageSize = 1000;
  expect(mocks.history.mock.calls).toEqual([
    ["child", { subagent: address, maxMessages: pageSize }],
    ["child", { subagent: address, beforeSeq: 20, maxMessages: pageSize }],
  ]);
});

const LOCAL_META_KEY = "sessions.local-meta";

function summary(id: string, updatedAt: number): Summary {
  return {
    sessionId: id,
    updatedAt,
    running: false,
    blank: false,
    title: id,
    agentPreset: "standard",
  };
}

function ids(sessions: { id: string }[]): string[] {
  return sessions.map((session) => session.id);
}

function archivedIds(sessions: { id: string; archived?: boolean }[]): string[] {
  return sessions.filter((session) => session.archived).map((s) => s.id);
}

function archiveCallIds(): string[] {
  return mocks.archiveSession.mock.calls.map((call) => call[0] as string);
}

beforeEach(() => {
  mocks.storage = {};
  mocks.summaries = [];
  mocks.archived = [];
  mocks.removed = [];
  mocks.set.mockReset();
  mocks.archiveSession.mockReset();
  // Every archive answers with the full updated set, exactly as DSH does.
  mocks.archiveSession.mockImplementation(async (id: string) => {
    if (!mocks.archived.includes(id)) mocks.archived = [...mocks.archived, id];
    return { archivedSessionIds: mocks.archived };
  });
});

describe("host archive projection", () => {
  it("marks a session archived when the HOST set names it", async () => {
    mocks.summaries = [summary("kept", 20), summary("filed", 10)];
    mocks.archived = ["filed"];

    const index = await loadIndex();
    expect(ids(index)).toEqual(["kept", "filed"]);
    expect(archivedIds(index)).toEqual(["filed"]);
  });

  it("ignores a stale sidecar archived flag — the host set is the truth", async () => {
    // Local metadata cannot override the host archive set.
    mocks.storage[LOCAL_META_KEY] = { ghost: { archived: true } };
    mocks.summaries = [summary("ghost", 10)];

    expect(archivedIds(await loadIndex())).toEqual([]);
  });

  it("keeps an archived session openable by id", async () => {
    mocks.summaries = [summary("filed", 10)];
    mocks.archived = ["filed"];

    await expect(loadSessionMeta("filed")).resolves.toMatchObject({
      id: "filed",
      archived: true,
      agent: { profileId: "standard" },
    });
  });

  it("archives through the host and answers with the updated set", async () => {
    mocks.archived = ["older"];
    await expect(archiveSession("fresh")).resolves.toEqual(
      new Set(["older", "fresh"]),
    );
    expect(archiveCallIds()).toEqual(["fresh"]);
  });
});

it("projects durable subagent origin on reload while retaining direct access", async () => {
  mocks.summaries = [{...summary("child", 20), origin:"subagent", parentSessionId:"parent"}, {...summary("fork", 10), parentSessionId:"parent"}];
  expect(await loadIndex()).toEqual(expect.arrayContaining([
    expect.objectContaining({id:"child",origin:"subagent",parentSessionId:"parent"}),
    expect.objectContaining({id:"fork",origin:undefined,parentSessionId:"parent"}),
  ]));
  expect(await loadSessionMeta("child")).toMatchObject({id:"child",origin:"subagent"});
  expect(JSON.stringify(mocks.storage[LOCAL_META_KEY] ?? {})).not.toContain('"origin"');
});


function legacyAttachmentEvent(id:string,seq=1) {
  return {event:{type:"user/message",seq,time:seq,data:{id:"message-"+seq,source:{kind:"user"},content:[{type:"text",text:
    '<file-attachment>\nName: "old.txt"\nKind: "text"\nMime: "text/plain"\nSize: 3 bytes\nAttachment-ID: "'+id+'"\n</file-attachment>\n\nOriginal words'
  }]}}};
}
it("loads old message text without an attachment migration service", async () => {
  mocks.history.mockResolvedValueOnce({events:[legacyAttachmentEvent("att_old")],hasMore:false});
  const messages=await loadMessages("old");
  expect(messages[0].content).toBe("Original words");
});

const historyEvent = (seq: number) => ({
  event: {
    type: "user/message",
    seq,
    time: seq,
    data: {
      id: `m${seq}`,
      source: { kind: "user" },
      content: [{ type: "text", text: `q${seq}` }],
    },
  },
});

it("reuses a loaded projection when the newest page reports the same revision", async () => {
  mocks.history.mockClear();
  const newest = { events: [historyEvent(2)], hasMore: true, projections: { asOfSeq: 7 } };
  const older = { events: [historyEvent(1)], hasMore: false, projections: { asOfSeq: 7 } };
  mocks.history.mockResolvedValueOnce(newest).mockResolvedValueOnce(older);

  const first = await loadMessages("revision-steady");
  expect(mocks.history).toHaveBeenCalledTimes(2); // the whole log

  // Same revision on the next read: the newest page is enough to trust the cache.
  mocks.history.mockResolvedValueOnce(newest);
  const second = await loadMessages("revision-steady");
  expect(mocks.history).toHaveBeenCalledTimes(3);
  expect(second).toEqual(first);
});

it("re-reads the whole log when the revision moved", async () => {
  mocks.history.mockClear();
  mocks.history
    .mockResolvedValueOnce({ events: [historyEvent(2)], hasMore: true, projections: { asOfSeq: 7 } })
    .mockResolvedValueOnce({ events: [historyEvent(1)], hasMore: false, projections: { asOfSeq: 7 } });
  const before = await loadMessages("revision-moved");

  mocks.history
    .mockResolvedValueOnce({ events: [historyEvent(5)], hasMore: true, projections: { asOfSeq: 9 } })
    .mockResolvedValueOnce({ events: [historyEvent(1)], hasMore: false, projections: { asOfSeq: 9 } });
  const after = await loadMessages("revision-moved");

  expect(mocks.history).toHaveBeenCalledTimes(4);
  expect(after).not.toEqual(before);
});
