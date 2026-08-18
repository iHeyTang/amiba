import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatform, type PlatformAdapter } from "@amiba/app-runtime/platform";

import { SettingsMemory } from "../SettingsMemory";

const list = vi.fn();
const reset = vi.fn();

describe("SettingsMemory DSH plugin", () => {
  beforeEach(() => {
    list.mockResolvedValue({
      preset: "researcher",
      targets: [{
        target: "user",
        path: "/dsh/amiba-memory/researcher/user.json",
        entries: [{
          id: "memory-1",
          preset: "researcher",
          target: "user",
          text: "Prefers Chinese.",
          flagged: null,
          createdAt: "2026-08-15T00:00:00.000Z",
          updatedAt: "2026-08-15T00:00:00.000Z",
        }],
        charCount: 16,
        charLimit: 12_000,
        flaggedCount: 0,
      }],
    });
    setPlatform({
      storage: { get: vi.fn().mockResolvedValue({}), set: vi.fn(), remove: vi.fn(), watch: vi.fn(() => () => {}) },
      agentMemory: { list, reset },
    } as unknown as PlatformAdapter);
  });

  it("renders preset-scoped durable memory without provider controls", async () => {
    render(<SettingsMemory profileId="researcher" />);
    await waitFor(() => expect(list).toHaveBeenCalledWith("researcher"));
    expect(screen.getByText("DSH long-term memory plugin")).toBeVisible();
    expect(screen.getByText("Prefers Chinese.")).toBeVisible();
    expect(screen.getByText("researcher")).toBeVisible();
  });
});
