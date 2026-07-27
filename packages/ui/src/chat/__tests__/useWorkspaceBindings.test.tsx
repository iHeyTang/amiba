import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getHermesMessagesMock = vi.hoisted(() => vi.fn());

vi.mock("@amiba/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@amiba/core")>()),
  getHermesMessages: getHermesMessagesMock,
}));

import {
  setPlatform,
  type PlatformAdapter,
  type WorkspaceChange,
} from "@amiba/platform";

import { useWorkspaceBindings } from "../internal/useWorkspaceBindings";

describe("useWorkspaceBindings", () => {
  let emit: (change: WorkspaceChange) => void;
  let bind: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getHermesMessagesMock.mockReset();
    getHermesMessagesMock.mockResolvedValue({
      ok: false,
      status: 404,
      error: "missing",
    });
    bind = vi.fn(async (sessionId: string, path: string) => {
      emit({ kind: "bound", sessionId, path });
    });
    setPlatform({
      kind: "desktop",
      workspaces: {
        bind,
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

  it("loads one binding snapshot and applies later changes incrementally", async () => {
    const { result } = renderHook(() => useWorkspaceBindings());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.bySessionId).toEqual({
      "session-a": "/workspaces/alpha",
      "session-b": "/workspaces/beta",
    });

    act(() => {
      emit({
        kind: "bound",
        sessionId: "session-c",
        path: "/workspaces/gamma",
      });
      emit({ kind: "unbound", sessionId: "session-a" });
    });

    expect(result.current.bySessionId).toEqual({
      "session-b": "/workspaces/beta",
      "session-c": "/workspaces/gamma",
    });
  });

  it("restores an explicit workspace binding from legacy conversation content", async () => {
    setPlatform({
      kind: "desktop",
      workspaces: {
        bind,
        unbind: vi.fn(),
        getCurrent: vi.fn(),
        listBindings: vi.fn(async () => ({})),
        onChange: (listener: (change: WorkspaceChange) => void) => {
          emit = listener;
          return () => {};
        },
      },
    } as unknown as PlatformAdapter);
    getHermesMessagesMock.mockResolvedValue({
      ok: true,
      session_id: "legacy-workspace",
      messages: [
        {
          role: "user",
          content:
            "<workspace>\n" +
            "Bound directory: /Users/dev/HeyClaw\n" +
            "Treat this as the working directory.\n" +
            "</workspace>\n\n" +
            "这是什么",
        },
      ],
    });

    const { result } = renderHook(() =>
      useWorkspaceBindings([
        {
          id: "legacy-workspace",
          title: "这是什么",
          createdAt: 1,
          updatedAt: 1,
          preview: "<workspace> Bound directory: /Users/dev/Hey…",
        },
        {
          id: "plain-session",
          title: "General question",
          createdAt: 2,
          updatedAt: 2,
          preview: "What can you do?",
        },
      ]),
    );

    await waitFor(() =>
      expect(bind).toHaveBeenCalledWith(
        "legacy-workspace",
        "/Users/dev/HeyClaw",
      ),
    );
    await waitFor(() =>
      expect(result.current.bySessionId["legacy-workspace"]).toBe(
        "/Users/dev/HeyClaw",
      ),
    );
    expect(getHermesMessagesMock).toHaveBeenCalledTimes(1);
    expect(getHermesMessagesMock).toHaveBeenCalledWith("legacy-workspace");
  });
});
