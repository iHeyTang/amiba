import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DshSettingsMessaging } from "../DshSettingsMessaging";

const list = vi.fn();
const listSessions = vi.fn();
const adapter = {
  list,
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  rotateSecret: vi.fn(),
};

describe("DshSettingsMessaging", () => {
  beforeEach(() => {
    list.mockResolvedValue({
      providers: [
        {
          id: "webhook",
          name: "Webhook",
          description: "Authenticated JSON transport",
          supportsInbound: true,
          supportsOutbound: true,
        },
      ],
      channels: [
        {
          id: "channel-1",
          provider: "webhook",
          name: "Operations",
          sessionId: "session-1",
          enabled: true,
          allowedSenders: [],
          createdAt: "2026-08-15T00:00:00.000Z",
          updatedAt: "2026-08-15T00:00:00.000Z",
        },
      ],
      inboundEndpoint: "http://127.0.0.1:2026/api/amiba/message-inbound",
    });
    listSessions.mockResolvedValue([
      {
        sessionId: "session-1",
        title: "Operations conversation",
        createdAt: 1,
        updatedAt: 2,
      },
    ]);
  });

  it("shows providers and routed channels when an older snapshot lacks delivery counters", async () => {
    render(
      <DshSettingsMessaging
        adapter={adapter}
        sessionsAdapter={{ list: listSessions }}
      />,
    );
    expect(await screen.findByText("Operations")).toBeVisible();
    expect(screen.getByText("Configured")).toBeVisible();
    expect(screen.getByText("Available channels")).toBeVisible();
    expect(
      screen.getByRole("searchbox", { name: "Search channels" }),
    ).toBeVisible();
    expect(screen.getAllByText("Webhook")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Set up Webhook" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Add channel" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/message-inbound/)).toBeVisible();
    expect(list).toHaveBeenCalled();
  });
});
