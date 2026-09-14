import { afterEach, expect, it, vi } from "vitest";
import { apply } from "./index.js";
import type { StewardInstance } from "../registry-store.js";

afterEach(() => vi.useRealTimers());
it("registers named entry/adoption targets and releases deleted entries without creating replacements", async () => {
  vi.useFakeTimers();
  let rows: StewardInstance[] = ["A", "B"].map((id) => ({
    id,
    name: `Steward ${id}`,
    responsibilities: id,
    background: "",
    context: "",
    sessionIds: [`session-${id}`],
    state: { version: 1, stewardSessionId: `session-${id}`, tasks: [] },
  }));
  const registrations = new Map<string, any>();
  const releases = new Map<string, ReturnType<typeof vi.fn>>();
  const ok = (value: unknown) => ({ ok: true, value });
  const remote = {
    instances: vi.fn(async () => ok(rows)),
    listTasks: vi.fn(async () => ok([])),
    ensureStewardSession: vi.fn(async (id: string) =>
      ok({ sessionId: `session-${id}` }),
    ),
    adopt: vi.fn(async () => ok({ kind: "adopted" })),
  };
  let disposeScope = () => {};
  const ctx = {
    effect: (fn: () => () => void) => fn(),
    remote: { amibaSteward: remote, $mount: async () => () => {} },
    slots: {
      inject: (_name: string, fn: () => unknown) => fn(),
      register: (options: any) => {
        const key = `${options.name}/${options.id ?? options.key}`;
        registrations.set(key, options);
        return () => registrations.delete(key);
      },
    },
    amibaSessionVisibility: {
      hideSession: (id: string) => {
        const release = vi.fn();
        releases.set(id, release);
        return release;
      },
    },
    layout: { openChat: vi.fn() },
    inject: (_deps: unknown, setup: (value: unknown) => () => void) => {
      disposeScope = setup(ctx);
      return Object.assign(Promise.resolve(), {
        dispose: async () => disposeScope(),
      });
    },
  };
  const dispose = await apply(ctx as never);
  try {
    await vi.waitFor(() =>
      expect(registrations.has("amiba.workspace.navigation/steward-B")).toBe(
        true,
      ),
    );
    expect(
      registrations.get("amiba.workspace.navigation/steward-A").label(),
    ).toBe("Steward A");
    expect(
      registrations.get("amiba.workspace.navigation/steward-B").label(),
    ).toBe("Steward B");
    const target = registrations
      .get("amiba.sessions.item.menu/steward-adopt-B")
      .inject();
    expect(target.visible({ id: "ordinary" })).toBe(true);
    expect(target.visible({ id: "session-A" })).toBe(false);
    await target.run({ id: "ordinary" });
    expect(remote.adopt).toHaveBeenCalledWith({
      stewardId: "B",
      sessionId: "ordinary",
    });
    rows = [];
    await vi.advanceTimersByTimeAsync(5000);
    expect(
      [...registrations.keys()].filter((key) =>
        key.startsWith("amiba.workspace.navigation/"),
      ),
    ).toEqual([]);
    expect(releases.get("session-A")).toHaveBeenCalledOnce();
    expect(releases.get("session-B")).toHaveBeenCalledOnce();
    expect(remote.ensureStewardSession).not.toHaveBeenCalled();
    expect(registrations.has("settings.section/steward")).toBe(true);
  } finally {
    await dispose();
  }
});
