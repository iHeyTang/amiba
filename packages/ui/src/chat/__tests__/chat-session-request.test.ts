import { beforeEach, describe, expect, it, vi } from "vitest";

import { setPlatform, type PlatformAdapter } from "@amiba/app-runtime/platform";
import { queueChatPrompt } from "../chat-session-request";

const storageSet = vi.fn(
  async (_patch: Record<string, unknown>): Promise<void> => {},
);

const platform: PlatformAdapter = {
  kind: "desktop",
  storage: {
    async get() {
      return {};
    },
    set: storageSet,
    async remove() {},
    watch() {
      return () => {};
    },
  },
  shell: {
    async openExternal() {},
  },
};

describe("queueChatPrompt workspace hand-off", () => {
  beforeEach(() => {
    storageSet.mockClear();
    setPlatform(platform);
  });

  it("keeps a draft workspace with the first prompt without creating a session", async () => {
    await queueChatPrompt({
      sessionId: "prepared-home",
      text: "Review this repository",
      workspacePath: "/workspaces/amiba-project",
    });

    expect(storageSet).toHaveBeenCalledOnce();
    expect(storageSet.mock.calls[0]?.[0]).toMatchObject({
      "home.pendingPrompt": {
        sessionId: "prepared-home",
        text: "Review this repository",
        workspacePath: "/workspaces/amiba-project",
      },
    });
  });

  it("hands the draft model to the first-turn transaction", async () => {
    await queueChatPrompt({
      text: "Explain this repository",
      modelSelection: {
        provider: "deepseek",
        model: "deepseek-reasoner",
        reasoningEffort: "high",
      },
    });

    expect(storageSet.mock.calls[0]?.[0]).toMatchObject({
      "home.pendingPrompt": {
        text: "Explain this repository",
        modelSelection: {
          provider: "deepseek",
          model: "deepseek-reasoner",
          reasoningEffort: "high",
        },
      },
    });
  });
});
