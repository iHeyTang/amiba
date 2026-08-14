import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  approveHermesPairing: vi.fn(),
  createHermesWebhook: vi.fn(),
  deleteHermesWebhook: vi.fn(),
  getHermesMessagingPlatforms: vi.fn(),
  getHermesPairings: vi.fn(),
  getHermesWebhooks: vi.fn(),
  restartHermesGateway: vi.fn(),
  revokeHermesPairing: vi.fn(),
  saveHermesMessagingPlatform: vi.fn(),
  setHermesWebhookEnabled: vi.fn(),
  testHermesMessagingPlatform: vi.fn(),
  updateHermesWebhook: vi.fn(),
}));

vi.mock("@amiba/core", () => core);

import { SettingsMessaging } from "../SettingsMessaging";

const platforms = [
  {
    id: "telegram",
    name: "Telegram",
    description: "Chat through Telegram.",
    docs_url: "https://example.com/telegram",
    enabled: false,
    configured: false,
    gateway_running: true,
    state: "not_configured",
    fields: [
      {
        key: "TELEGRAM_BOT_TOKEN",
        required: true,
        configured: false,
        label: "Bot token",
        description: "Token from BotFather",
        secret: true,
        advanced: false,
      },
    ],
  },
  {
    id: "discord",
    name: "Discord",
    description: "Chat through Discord.",
    enabled: true,
    configured: true,
    gateway_running: true,
    state: "connected",
    fields: [],
  },
];

describe("SettingsMessaging channel setup", () => {
  beforeEach(() => {
    Object.values(core).forEach((mock) => mock.mockReset());
    core.getHermesMessagingPlatforms.mockResolvedValue({
      ok: true,
      gateway_running: true,
      gateway_state: "running",
      platforms,
    });
    core.saveHermesMessagingPlatform.mockResolvedValue({ ok: true });
    core.restartHermesGateway.mockResolvedValue({ ok: true });
    core.testHermesMessagingPlatform.mockResolvedValue({
      ok: true,
      state: "connected",
    });
  });

  it("renders live channel status in user-facing language", async () => {
    render(<SettingsMessaging profileId="default" />);

    expect(await screen.findByText("1 of 2 channels connected")).toBeVisible();
    expect(screen.getByText("Messaging service is running")).toBeVisible();
    expect(screen.getByText("Connected")).toBeVisible();
    expect(screen.getByText("Needs setup")).toBeVisible();
    expect(screen.getByText("Configured")).toBeVisible();
    expect(screen.getByText("Other channels")).toBeVisible();
    expect(screen.getByRole("img", { name: "Discord logo" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Telegram logo" })).toBeVisible();

    const discord = screen.getByText("Discord");
    const telegram = screen.getByText("Telegram");
    expect(
      discord.compareDocumentPosition(telegram) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText("TELEGRAM_BOT_TOKEN")).not.toBeInTheDocument();
    expect(core.getHermesMessagingPlatforms).toHaveBeenCalledWith("default");
  });

  it("keeps a previously configured channel pinned when it is disabled", async () => {
    core.getHermesMessagingPlatforms.mockResolvedValueOnce({
      ok: true,
      gateway_running: true,
      gateway_state: "running",
      platforms: [
        ...platforms,
        {
          id: "feishu",
          name: "Feishu / Lark",
          description: "Use Amiba inside Feishu or Lark.",
          enabled: false,
          configured: true,
          gateway_running: true,
          state: "disabled",
          fields: [],
        },
      ],
    });

    render(<SettingsMessaging profileId="default" />);

    const configuredSection = (await screen.findByText("Configured")).closest(
      "section",
    );
    const otherSection = screen.getByText("Other channels").closest("section");
    expect(configuredSection).not.toBeNull();
    expect(otherSection).not.toBeNull();
    expect(within(configuredSection!).getByText("Discord")).toBeVisible();
    expect(within(configuredSection!).getByText("Feishu / Lark")).toBeVisible();
    expect(within(otherSection!).queryByText("Feishu / Lark")).toBeNull();
  });

  it("guides setup, saves the real credential, and restarts Gateway", async () => {
    const user = userEvent.setup();
    render(<SettingsMessaging profileId="default" />);

    await user.click(await screen.findByRole("button", { name: "Set up" }));
    expect(screen.getByText("Prepare the channel")).toBeVisible();
    expect(screen.getByText("Add connection details")).toBeVisible();
    expect(screen.getByText("Connect and verify")).toBeVisible();

    const connect = screen.getByRole("button", { name: "Save and connect" });
    expect(connect).toBeDisabled();

    await user.type(screen.getByLabelText(/Bot token/), "real-token");
    expect(connect).toBeEnabled();
    await user.click(connect);

    await waitFor(() => {
      expect(core.saveHermesMessagingPlatform).toHaveBeenCalledWith(
        "telegram",
        {
          enabled: true,
          env: { TELEGRAM_BOT_TOKEN: "real-token" },
        },
        "default",
      );
    });
    expect(core.restartHermesGateway).toHaveBeenCalledOnce();
    expect(
      await screen.findByText(
        "Telegram was saved. Connection status will update automatically.",
      ),
    ).toBeVisible();
  });
});
