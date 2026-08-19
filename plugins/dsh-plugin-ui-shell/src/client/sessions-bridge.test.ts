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
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const face: OfficialSessionsFace = {
    list: {
      getSnapshot: (): OfficialSessionListSnapshot => ({ ids, current }),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    open: vi.fn((id: string) => {
      if (!ids.includes(id)) {
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
    get current() {
      return current;
    },
  };
}

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("sessions selection bridge", () => {
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
    const official = officialSessionsDouble({ ids: ["s1", "s9"], current: "s1" });
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
