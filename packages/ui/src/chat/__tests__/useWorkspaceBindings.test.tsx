import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  setPlatform,
  type PlatformAdapter,
  type WorkspaceChange,
} from "@amiba/app-runtime/platform";

import { useWorkspaceBindings } from "../internal/useWorkspaceBindings";

describe("useWorkspaceBindings", () => {
  let emit: (change: WorkspaceChange) => void;

  beforeEach(() => {
    setPlatform({
      kind: "desktop",
      workspaces: {
        getDefaultRoot: vi.fn(async () => "/Users/test"),
        bind: vi.fn(),
        unbind: vi.fn(),
        getCurrent: vi.fn(),
        listBindings: vi.fn(async () => ({
          "session-a": "/workspaces/alpha",
          "session-b": "/workspaces/beta",
        })),
        onChange: (listener: (change: WorkspaceChange) => void) => {
          emit = listener;
          return () => {};
        },
      },
    } as unknown as PlatformAdapter);
  });

  it("maps unbound DSH sessions to the product default workspace", async () => {
    const { result } = renderHook(() =>
      useWorkspaceBindings([
        { id: "session-a", title: "Explicit", createdAt: 1, updatedAt: 1 },
        { id: "session-c", title: "Default", createdAt: 2, updatedAt: 2 },
      ]),
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.bySessionId).toEqual({
      "session-a": "/workspaces/alpha",
      "session-b": "/workspaces/beta",
      "session-c": "/Users/test",
    });
  });

  it("applies workspace events incrementally without transcript migration", async () => {
    const { result } = renderHook(() => useWorkspaceBindings());
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => {
      emit({ kind: "bound", sessionId: "session-c", path: "/workspaces/gamma" });
      emit({ kind: "unbound", sessionId: "session-a" });
    });
    expect(result.current.bySessionId).toEqual({
      "session-b": "/workspaces/beta",
      "session-c": "/workspaces/gamma",
    });
  });
});
