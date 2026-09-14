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
  retainForSession: vi.fn(async (_attachmentId: string, _sessionId: string) => {}),
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
    agentAttachments: { retainForSession: mocks.retainForSession },
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
  expect(mocks.history.mock.calls).toEqual([
    ["child", { subagent: address, maxMessages: 200 }],
    ["child", { subagent: address, beforeSeq: 20, maxMessages: 200 }],
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
it("migrates deduplicated real Host attachment IDs across historical pages",async()=>{
  const id="att_0123456789abcdef0123456789abcdef";
  mocks.retainForSession.mockClear();
  mocks.history.mockResolvedValueOnce({events:[legacyAttachmentEvent(id,2)],hasMore:true});
  mocks.history.mockResolvedValueOnce({events:[legacyAttachmentEvent(id),legacyAttachmentEvent("sha256:inline",3)],hasMore:false});
  const messages=await loadMessages("old-session");
  expect(mocks.retainForSession.mock.calls).toEqual([[id,"old-session"]]);
  expect(messages.filter(message=>message.role==="user").map(message=>message.content)).toEqual(["Original words","Original words","Original words"]);
});
it("does not treat a bare attachment ID as a historical file reference",async()=>{
  mocks.retainForSession.mockClear();
  mocks.history.mockResolvedValueOnce({events:[{event:{type:"user/message",seq:1,time:1,data:{id:"u",source:{kind:"user"},content:[{type:"text",text:"att_0123456789abcdef0123456789abcdef"}]}}}],hasMore:false});
  await loadMessages("plain");
  expect(mocks.retainForSession).not.toHaveBeenCalled();
});
it("missing old files do not block history, and archive does not release its references",async()=>{
  mocks.retainForSession.mockClear();
  mocks.retainForSession.mockRejectedValueOnce(new Error("File missing"));
  const warning=vi.spyOn(console,"warn").mockImplementation(()=>{});
  mocks.history.mockResolvedValueOnce({events:[legacyAttachmentEvent("att_0123456789abcdef0123456789abcdef")],hasMore:false});
  const messages=await loadMessages("old");
  expect(messages[0].content).toBe("Original words");
  await archiveSession("old");
  expect(mocks.retainForSession).toHaveBeenCalledOnce();
  warning.mockRestore();
});
