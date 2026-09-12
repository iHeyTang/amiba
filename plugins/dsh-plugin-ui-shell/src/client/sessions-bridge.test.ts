// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import {
  createSessionsBridge,
  type OfficialSessionListSnapshot,
  type OfficialSessionsFace,
} from "./sessions-bridge.js";

/**
 * Honest mock of the official `ctx.sessions` face this bridge consumes:
 * `open()` reproduces dsh-client-runtime's fail-loud semantics (the manager
 * throws `sessions.select: unknown session <id>` for ids not in its list)
 * and, like the real notifier, `open`/`clear` publish a fresh snapshot to
 * subscribers synchronously.
 */
function officialSessionsDouble(initial?: {
  ids?: string[];
  current?: string;
}) {
  let ids: string[] = initial?.ids ?? [];
  let current: string | undefined = initial?.current;
  const addresses = new Map<string, { parentSessionId: string; childSessionId: string; mode: "one-shot" | "continuable" }>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const face: OfficialSessionsFace = {
    subagentAddress: (id) => addresses.get(id),
    list: {
      getSnapshot: (): OfficialSessionListSnapshot => ({ ids, current }),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    open: vi.fn((id: string) => {
      if (!ids.includes(id) && !addresses.has(id)) {
        throw new Error(`sessions.select: unknown session ${id}`);
      }
      current = id;
      notify();
    }),
    clear: vi.fn(() => {
      current = undefined;
      notify();
    }),
  };
  return {
    face,
    retainAddress(id: string) {
      addresses.set(id, { parentSessionId: "parent", childSessionId: id, mode: "continuable" });
      notify();
    },
    forgetAddress(id: string) {
      addresses.delete(id);
      notify();
    },
    /** Simulate the host list gaining rows (stream/list refresh). */
    setIds(next: string[]) {
      ids = next;
      notify();
    },
    /** Simulate an official-ecosystem selection change. */
    setCurrent(next: string | undefined) {
      current = next;
      notify();
    },
    requestOpen(id: string, source = "explicit") {
      Object.assign(face, { lastOpenRequest: { sessionId: id, source } });
      face.open(id);
    },
    requestClear() {
      Object.assign(face, {lastClearRequest: {}});
      face.clear();
    },
    get current() {
      return current;
    },
  };
}

const flushMicrotasks = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("sessions selection bridge", () => {
  it("forwards the retained direct-parent address when a plugin opens a child", () => {
    const official = officialSessionsDouble({ ids: ["parent"], current: "parent" });
    official.retainAddress("child");
    const onExternalOpen = vi.fn();
    const bridge = createSessionsBridge(official.face, onExternalOpen);
    bridge.setActive("parent");
    official.requestOpen("child");
    expect(onExternalOpen).toHaveBeenCalledTimes(1);
    expect(onExternalOpen).toHaveBeenCalledWith("child", {
      parentSessionId: "parent", childSessionId: "child", mode: "continuable",
    });
    const sent = onExternalOpen.mock.calls[0]![1];
    expect(sent).not.toBe(official.face.subagentAddress!("child"));
    bridge.dispose();
  });

  it("defers a failed immediate child open and retries on the next catalog update", async () => {
    const official = officialSessionsDouble({ ids: ["parent"], current: "parent" });
    official.retainAddress("child");
    const open = official.face.open;
    official.face.open = vi.fn().mockImplementationOnce(() => {
      throw new Error("catalog changed while selecting");
    }).mockImplementation(open);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const bridge = createSessionsBridge(official.face, vi.fn());
    try {
      bridge.setActive("child");
      expect(official.current).toBeUndefined();
      official.retainAddress("child");
      await flushMicrotasks();
      expect(official.current).toBe("child");
      expect(official.face.open).toHaveBeenCalledTimes(2);
    } finally {
      bridge.dispose();
      log.mockRestore();
    }
  });

  it("reopens a retained catalog child absent from the root list", () => {
    const official = officialSessionsDouble({ ids: ["parent"] });
    official.retainAddress("child");
    const onExternalOpen = vi.fn();
    const bridge = createSessionsBridge(official.face, onExternalOpen);
    bridge.setActive("child");
    bridge.setActive("parent");
    bridge.setActive("child");
    expect(official.current).toBe("child");
    expect(official.face.open).toHaveBeenNthCalledWith(3, "child");
    expect(onExternalOpen).not.toHaveBeenCalled();
    bridge.dispose();
  });

  it("resolves a deferred child when its address arrives without a root-list row", async () => {
    const official = officialSessionsDouble({ ids: ["parent"] });
    const bridge = createSessionsBridge(official.face, vi.fn());
    bridge.setActive("child");
    official.retainAddress("child");
    await flushMicrotasks();
    expect(official.current).toBe("child");
    bridge.dispose();
  });

  it("rechecks a queued child's address and retries when it becomes available again", async () => {
    const official = officialSessionsDouble({ ids: ["parent"] });
    const bridge = createSessionsBridge(official.face, vi.fn());
    bridge.setActive("child");
    official.retainAddress("child");
    official.forgetAddress("child");
    await flushMicrotasks();
    expect(official.face.open).not.toHaveBeenCalled();
    official.retainAddress("child");
    await flushMicrotasks();
    expect(official.current).toBe("child");
    bridge.dispose();
  });

  it("does not reopen a deferred child after Amiba deselects", async () => {
    const official = officialSessionsDouble();
    const bridge = createSessionsBridge(official.face, vi.fn());
    bridge.setActive("child");
    official.retainAddress("child");
    bridge.setActive("");
    await flushMicrotasks();
    expect(official.face.open).not.toHaveBeenCalled();
    expect(official.current).toBeUndefined();
    bridge.dispose();
  });

  it("opens listed ids directly and suppresses the echo", () => {
    const official = officialSessionsDouble({ ids: ["s1", "s2"] });
    const onExternalOpen = vi.fn();
    const bridge = createSessionsBridge(official.face, onExternalOpen);

    bridge.setActive("s2");

    expect(official.face.open).toHaveBeenCalledWith("s2");
    expect(official.current).toBe("s2");
    // The current-change our own open produced is an echo, not an external open.
    expect(onExternalOpen).not.toHaveBeenCalled();
    bridge.dispose();
  });

  it("defers an unlisted id until the official list gains it (open-after-list race)", async () => {
    const official = officialSessionsDouble({ ids: ["s1"], current: "s1" });
    const onExternalOpen = vi.fn();
    const bridge = createSessionsBridge(official.face, onExternalOpen);

    // Fresh Amiba draft: not in the official list yet. The official open()
    // fails loud on unknown ids, so the bridge must NOT call it yet…
    bridge.setActive("draft-1");
    expect(official.face.open).not.toHaveBeenCalled();
    // …and clears the stale official selection so official session-scoped
    // slots stop rendering s1 under the draft surface.
    expect(official.face.clear).toHaveBeenCalledTimes(1);

    // First submit materializes the DSH session; the official list catches up.
    official.setIds(["s1", "draft-1"]);
    await flushMicrotasks();
    expect(official.face.open).toHaveBeenCalledWith("draft-1");
    expect(official.current).toBe("draft-1");
    expect(onExternalOpen).not.toHaveBeenCalled();
    bridge.dispose();
  });

  it("drops a deferred target superseded by a newer setActive", async () => {
    const official = officialSessionsDouble({ ids: ["s1"] });
    const bridge = createSessionsBridge(official.face, vi.fn());

    bridge.setActive("draft-1");
    bridge.setActive("s1"); // user moved on before the draft materialized
    expect(official.current).toBe("s1");

    official.setIds(["s1", "draft-1"]);
    await flushMicrotasks();
    // The stale deferred open must not fire.
    expect(official.face.open).toHaveBeenCalledTimes(1);
    expect(official.current).toBe("s1");
    bridge.dispose();
  });

  it("clears the official selection when Amiba deselects, and no-ops when already empty", () => {
    const official = officialSessionsDouble({ ids: ["s1"], current: "s1" });
    const onExternalOpen = vi.fn();
    const bridge = createSessionsBridge(official.face, onExternalOpen);

    bridge.setActive("");
    expect(official.face.clear).toHaveBeenCalledTimes(1);
    expect(official.current).toBeUndefined();

    bridge.setActive("");
    expect(official.face.clear).toHaveBeenCalledTimes(1);
    expect(onExternalOpen).not.toHaveBeenCalled();
    bridge.dispose();
  });

  it("forwards an official-ecosystem open and settles without ping-pong", () => {
    const official = officialSessionsDouble({
      ids: ["s1", "s9"],
      current: "s1",
    });
    const onExternalOpen = vi.fn();
    const bridge = createSessionsBridge(official.face, onExternalOpen);
    bridge.setActive("s1");

    official.setCurrent("s9"); // e.g. an official contribution called open()
    expect(onExternalOpen).toHaveBeenCalledTimes(1);
    expect(onExternalOpen).toHaveBeenCalledWith("s9");

    // The Amiba open-session path lands on activeId=s9 and mirrors it back:
    // the official side already has s9 current, so no open fires at all
    // (the s1 push also no-opped — s1 was already current at mount).
    bridge.setActive("s9");
    expect(official.face.open).not.toHaveBeenCalled();
    expect(onExternalOpen).toHaveBeenCalledTimes(1);
    bridge.dispose();
  });

  it("does not follow the runtime's own boot selection into an empty window", () => {
    // Faithful cold-boot double: the real list store starts EMPTY and
    // pending — a persisted `dsh.sessions.current` only reaches
    // `list.current` after the async `session.list` baseline lands, so the
    // constructor can never observe it.
    const official = officialSessionsDouble();
    const onExternalOpen = vi.fn();
    const bridge = createSessionsBridge(official.face, onExternalOpen);
    bridge.setActive(""); // the shell's mount-time projection

    // The baseline lands carrying the runtime's restored selection.
    official.setIds(["s5"]);
    official.setCurrent("s5");

    // Amiba windows start empty by design: runtime policy is re-projected
    // away, never forwarded as a user-initiated open.
    expect(onExternalOpen).not.toHaveBeenCalled();
    expect(official.face.clear).toHaveBeenCalled();
    expect(official.current).toBeUndefined();
    bridge.dispose();
  });

  it("re-projects the empty selection when the runtime opens its initial workspace session later", () => {
    const official = officialSessionsDouble({ ids: ["s1"] });
    const onExternalOpen = vi.fn();
    const bridge = createSessionsBridge(official.face, onExternalOpen);
    bridge.setActive("");

    // `workspaces.startInitialSelection()` connects the recent workspace and
    // opens its session — after the list has settled, with Amiba on home.
    official.setCurrent("s1");
    expect(onExternalOpen).not.toHaveBeenCalled();
    expect(official.current).toBeUndefined();
    bridge.dispose();
  });

  it("re-defers a target whose row leaves the list before the deferred open", async () => {
    const official = officialSessionsDouble({ ids: ["s1"] });
    const onExternalOpen = vi.fn();
    const bridge = createSessionsBridge(official.face, onExternalOpen);
    bridge.setActive("draft-1");

    official.setIds(["s1", "draft-1"]); // queues the deferred open…
    official.setIds(["s1"]); // …and the row vanishes again first
    await flushMicrotasks();
    expect(official.current).toBeUndefined();

    // The target stayed deferred instead of dropping into a silent desync.
    official.setIds(["s1", "draft-1"]);
    await flushMicrotasks();
    expect(official.current).toBe("draft-1");
    bridge.dispose();
  });

  it("does not forward an official clear (recorded asymmetry) and stays consistent after it", () => {
    const official = officialSessionsDouble({ ids: ["s1", "s2"] });
    const onExternalOpen = vi.fn();
    const bridge = createSessionsBridge(official.face, onExternalOpen);
    bridge.setActive("s1");

    official.setCurrent(undefined); // ecosystem clear — no Amiba route today
    expect(onExternalOpen).not.toHaveBeenCalled();
    // Amiba is authoritative: its live selection is re-projected instead of
    // leaving the official session-scoped seats rendering nothing.
    expect(official.current).toBe("s1");

    // A later external open still forwards.
    official.setCurrent("s2");
    expect(onExternalOpen).toHaveBeenCalledTimes(1);
    expect(onExternalOpen).toHaveBeenCalledWith("s2");
    bridge.dispose();
  });

  it("stops projecting after dispose", async () => {
    const official = officialSessionsDouble({ ids: ["s1"] });
    const onExternalOpen = vi.fn();
    const bridge = createSessionsBridge(official.face, onExternalOpen);

    bridge.setActive("draft-1");
    bridge.dispose();
    official.setIds(["s1", "draft-1"]);
    official.setCurrent("s1");
    await flushMicrotasks();
    expect(official.face.open).not.toHaveBeenCalled();
    expect(onExternalOpen).not.toHaveBeenCalled();
  });
});

describe("explicit navigation intent", () => {
  it("follows a plugin open from home but suppresses initial workspace selection", () => {
    const official = officialSessionsDouble({ ids: ["s1"] });
    const opened = vi.fn();
    const bridge = createSessionsBridge(official.face, opened);
    bridge.setActive("");
    official.requestOpen("s1", "initial");
    expect(opened).not.toHaveBeenCalled();
    expect(official.current).toBeUndefined();
    official.requestOpen("s1");
    expect(opened).toHaveBeenCalledWith("s1");
    bridge.setActive("s1");
    expect(official.current).toBe("s1");
    expect(opened).toHaveBeenCalledTimes(1);
    bridge.dispose();
  });

  it("does not let a queued draft projection override a newer plugin open", async () => {
    const official = officialSessionsDouble({ ids: ["s1"] });
    const opened = vi.fn();
    const bridge = createSessionsBridge(official.face, opened);
    bridge.setActive("draft");
    official.setIds(["s1", "draft"]);
    official.requestOpen("s1");
    await flushMicrotasks();
    expect(opened).toHaveBeenCalledWith("s1");
    expect(official.current).toBe("s1");
    bridge.setActive("s1");
    bridge.dispose();
  });

  it("consumes intent once and does not mistake a later restore for another open", () => {
    const official = officialSessionsDouble({ ids: ["s1"] });
    const opened = vi.fn();
    const bridge = createSessionsBridge(official.face, opened);
    official.requestOpen("s1");
    bridge.setActive("s1");
    bridge.setActive("");
    official.setCurrent("s1");
    expect(opened).toHaveBeenCalledTimes(1);
    expect(official.current).toBeUndefined();
    bridge.dispose();
    official.requestOpen("s1");
    expect(opened).toHaveBeenCalledTimes(1);
  });
});

it("preserves catalog-style navigation after an earlier marked open", () => {
  const official = officialSessionsDouble({ ids: ["s1", "s2"] });
  const opened = vi.fn();
  const bridge = createSessionsBridge(official.face, opened);
  official.requestOpen("s1");
  bridge.setActive("s1");
  opened.mockClear();
  official.setCurrent("s2");
  expect(opened).toHaveBeenCalledWith("s2");
  bridge.dispose();
});

it("forwards explicit clear into deselect without closing or reopening a session", async () => {
  const official=officialSessionsDouble({ids:["s1"]});
  const open=vi.fn(),clear=vi.fn();
  const bridge=createSessionsBridge(official.face,open,clear);
  bridge.setActive("s1");
  official.requestClear();
  expect(clear).toHaveBeenCalledTimes(1);
  expect(official.current).toBeUndefined();
  bridge.setActive("");
  expect(clear).toHaveBeenCalledTimes(1);
  bridge.setActive("pending");
  official.requestClear();
  official.setIds(["s1","pending"]);
  await flushMicrotasks();
  expect(official.current).toBeUndefined();
  expect(clear).toHaveBeenCalledTimes(2);
  bridge.dispose();
});
it("suppresses bridge clear echoes and retains unmarked runtime-loss behavior", () => {
  const official=officialSessionsDouble({ids:["s1"]});
  const originalClear=official.face.clear;
  official.face.clear=()=>{Object.assign(official.face,{lastClearRequest:{}});originalClear();};
  const clear=vi.fn();
  const bridge=createSessionsBridge(official.face,vi.fn(),clear);
  bridge.setActive("s1");
  official.setCurrent(undefined);
  expect(official.current).toBe("s1");
  bridge.setActive("draft");
  expect(clear).not.toHaveBeenCalled();
  bridge.dispose();
});
