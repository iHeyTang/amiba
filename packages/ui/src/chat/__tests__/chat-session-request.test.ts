import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  setPlatform,
  type PlatformAdapter,
} from "@amiba/platform";
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
  runtime: {
    async sendMessage<T>() {
      return undefined as T;
    },
    onMessage() {
      return () => {};
    },
    async getInstallId() {
      return "test";
    },
  },
  tabs: {
    async query() {
      return [];
    },
    async create() {
      return { id: 1 };
    },
    async update() {
      return { id: 1 };
    },
    async remove() {},
  },
  scripting: {
    async executeScript() {
      return [];
    },
  },
  bookmarks: {
    async search() {
      return [];
    },
  },
  history: {
    async search() {
      return [];
    },
  },
  windows: {
    async getCurrent() {
      return { id: 1, focused: true };
    },
    async create() {
      return { id: 1 };
    },
  },
  notifications: {
    async notify() {},
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
      text: "Review this repository",
      workspacePath: "/workspaces/hermes-x",
    });

    expect(storageSet).toHaveBeenCalledOnce();
    expect(storageSet.mock.calls[0]?.[0]).toMatchObject({
      "home.pendingPrompt": {
        text: "Review this repository",
        workspacePath: "/workspaces/hermes-x",
      },
    });
  });
});
