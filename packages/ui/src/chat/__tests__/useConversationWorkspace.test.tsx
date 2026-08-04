import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlatformAdapter, WorkspaceChange } from "@amiba/platform";
import { setPlatform } from "@amiba/platform";

import { useConversationWorkspace } from "../internal/useConversationWorkspace";

describe("useConversationWorkspace", () => {
  const paths: Record<string, string | null> = {
    "session-a": "/workspaces/alpha",
    "session-b": "/workspaces/beta",
  };

  beforeEach(() => {
    const listeners = new Set<(change: WorkspaceChange) => void>();
    setPlatform({
      kind: "desktop",
      workspaces: {
        getDefaultRoot: vi.fn(async () => "/Users/test"),
        bind: vi.fn(),
        unbind: vi.fn(),
        getCurrent: vi.fn(
          async (sessionId: string) => paths[sessionId] ?? "/Users/test",
        ),
        listBindings: vi.fn(async () => ({})),
        onChange: (listener: (change: WorkspaceChange) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    } as unknown as PlatformAdapter);
  });

  it("restores the directory that belongs to each active conversation", async () => {
    const { result, rerender } = renderHook(
      ({ activeId }) =>
        useConversationWorkspace({
          sessions: { activeId } as never,
        }),
      { initialProps: { activeId: "session-a" } },
    );

    await waitFor(() => {
      expect(result.current.workspacePath).toBe("/workspaces/alpha");
    });

    rerender({ activeId: "session-b" });
    await waitFor(() => {
      expect(result.current.workspacePath).toBe("/workspaces/beta");
    });

    rerender({ activeId: "session-c" });
    await waitFor(() => {
      expect(result.current.workspacePath).toBe("/Users/test");
    });
  });
});
