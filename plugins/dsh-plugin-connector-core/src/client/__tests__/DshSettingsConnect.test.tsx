import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DshSettingsConnect } from "../DshSettingsConnect";
import type { ConnectorProviderView, ConnectView } from "../../types";

const listProviders = vi.fn();
const list = vi.fn();
const create = vi.fn();
const setEnabled = vi.fn();
const remove = vi.fn();
const setOwners = vi.fn();

const adapter = { listProviders, list, create, setEnabled, remove, setOwners };

const providers: ConnectorProviderView[] = [
  { id: "lark", name: "Lark", description: "Feishu/Lark bot connector" },
  { id: "webhook", name: "Webhook", description: "Generic JSON webhook" },
];

const connects: ConnectView[] = [
  {
    id: "connect-1",
    provider: "lark",
    name: "Sales bot",
    enabled: true,
    pairing: false,
    owners: ["u1", "u2"],
    agentPreset: "restricted",
    channelId: "channel-1",
    status: { state: "ready" },
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
  },
  {
    id: "connect-2",
    provider: "webhook",
    name: "Ops relay",
    enabled: false,
    pairing: true,
    owners: [],
    status: { state: "connecting" },
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
  },
  {
    id: "connect-3",
    provider: "lark",
    name: "Broken bot",
    enabled: true,
    pairing: false,
    owners: ["u3"],
    status: { state: "error", detail: "invalid token" },
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
  },
];

function connectView(overrides: Partial<ConnectView> = {}): ConnectView {
  return { ...connects[0]!, ...overrides };
}

describe("DshSettingsConnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listProviders.mockResolvedValue(providers);
    list.mockResolvedValue(connects);
  });

  it("lists connects with provider name, status badges, and owner counts", async () => {
    const { container } = render(<DshSettingsConnect adapter={adapter} />);

    expect(await screen.findByText("Sales bot")).toBeVisible();
    expect(screen.getByText("Ready")).toBeVisible();
    expect(screen.getByText("Connecting")).toBeVisible();
    expect(screen.getByText("Error: invalid token")).toBeVisible();
    expect(screen.getAllByText("Lark")).toHaveLength(2);
    expect(screen.getByText("Webhook")).toBeVisible();
    expect(
      screen.getByRole("button", { name: /2 owners/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /0 owners/ }),
    ).toBeVisible();

    // Layout rule: no PaneHeaderBar/Scaffold — root is a plain flex column
    // wrapping ScrollArea, per the brief's bullet 6.
    expect(container.firstElementChild).toHaveClass(
      "flex",
      "min-h-0",
      "min-w-0",
      "flex-1",
      "flex-col",
    );
  });

  it("shows the empty state and a disabled add button with a hint when no providers are installed", async () => {
    listProviders.mockResolvedValue([]);
    list.mockResolvedValue([]);
    render(<DshSettingsConnect adapter={adapter} />);

    expect(await screen.findByText("No connects yet")).toBeVisible();
    expect(
      screen.getByText(
        "Install a platform plugin (for example Lark) to add a connect.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /Add connect/ })).toBeDisabled();
  });

  it("shows the empty state with an enabled, reachable add flow when providers exist but there are no connects yet", async () => {
    const user = userEvent.setup();
    listProviders.mockResolvedValue(providers);
    list.mockResolvedValue([]);
    render(<DshSettingsConnect adapter={adapter} />);

    expect(await screen.findByText("No connects yet")).toBeVisible();
    expect(
      screen.queryByText(
        "Install a platform plugin (for example Lark) to add a connect.",
      ),
    ).not.toBeInTheDocument();
    const addButton = screen.getByRole("button", { name: /Add connect/ });
    expect(addButton).toBeEnabled();

    await user.click(addButton);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("creates a lark connect from the add dialog with the three lark-specific fields", async () => {
    const user = userEvent.setup();
    create.mockResolvedValue(connectView());
    render(<DshSettingsConnect adapter={adapter} />);

    await user.click(await screen.findByRole("button", { name: /Add connect/ }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Connect name"), "Support bot");
    await user.clear(within(dialog).getByLabelText("Agent preset"));
    await user.type(within(dialog).getByLabelText("Agent preset"), "support");
    await user.type(within(dialog).getByLabelText("App ID"), "app-123");
    await user.type(within(dialog).getByLabelText("App secret"), "secret-xyz");

    const appSecretField = within(dialog).getByLabelText("App secret");
    expect(appSecretField).toHaveAttribute("type", "password");

    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(create).toHaveBeenCalledWith({
      provider: "lark",
      name: "Support bot",
      agentPreset: "support",
      config: { appId: "app-123", appSecret: "secret-xyz", domain: "feishu" },
    });
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("surfaces a translated message for a known create error, inline in the dialog", async () => {
    const user = userEvent.setup();
    create.mockRejectedValue(new Error("agent_preset_required"));
    render(<DshSettingsConnect adapter={adapter} />);

    await user.click(await screen.findByRole("button", { name: /Add connect/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Connect name"), "Support bot");
    await user.type(within(dialog).getByLabelText("App ID"), "app-123");
    await user.type(within(dialog).getByLabelText("App secret"), "secret-xyz");

    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(
      await within(dialog).findByText(
        "Choose an agent preset before creating this connect.",
      ),
    ).toBeVisible();
    // The dialog stays open on failure.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("disables submit and shows an inline parse error for invalid JSON on a non-lark provider", async () => {
    const user = userEvent.setup();
    render(<DshSettingsConnect adapter={adapter} />);

    await user.click(await screen.findByRole("button", { name: /Add connect/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByLabelText("Provider"));
    await user.click(await screen.findByRole("option", { name: "Webhook" }));
    await user.type(within(dialog).getByLabelText("Connect name"), "Relay");
    await user.type(
      within(dialog).getByLabelText("Provider configuration"),
      "definitely not json",
    );

    expect(
      await within(dialog).findByText(
        "Configuration must be valid JSON for an object.",
      ),
    ).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Add" })).toBeDisabled();
    expect(create).not.toHaveBeenCalled();
  });

  it("toggles enabled state through adapter.setEnabled and refreshes", async () => {
    const user = userEvent.setup();
    setEnabled.mockResolvedValue(connectView({ enabled: false }));
    render(<DshSettingsConnect adapter={adapter} />);

    await screen.findByText("Sales bot");
    const row = screen.getByText("Sales bot").closest("article")!;
    await user.click(within(row).getByRole("button", { name: "Turn off" }));

    expect(setEnabled).toHaveBeenCalledWith("connect-1", false);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("removes a connect only after confirming", async () => {
    const user = userEvent.setup();
    remove.mockResolvedValue({ id: "connect-1", deleted: true });
    render(<DshSettingsConnect adapter={adapter} />);

    await screen.findByText("Sales bot");
    const row = screen.getByText("Sales bot").closest("article")!;
    await user.click(within(row).getByRole("button", { name: "Remove" }));

    expect(
      within(row).getByText("Remove this connect? This cannot be undone."),
    ).toBeVisible();
    expect(remove).not.toHaveBeenCalled();

    await user.click(
      within(row).getByRole("button", { name: "Confirm removal" }),
    );

    expect(remove).toHaveBeenCalledWith("connect-1");
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("adds and removes an owner through the row's owners editor", async () => {
    const user = userEvent.setup();
    setOwners.mockResolvedValue(connectView({ owners: ["u1", "u2", "u3"] }));
    render(<DshSettingsConnect adapter={adapter} />);

    await screen.findByText("Sales bot");
    const row = screen.getByText("Sales bot").closest("article")!;
    await user.click(within(row).getByRole("button", { name: /2 owners/ }));

    expect(
      within(row).getByText(
        "While this connect is pairing, the first sender to message it is automatically added as an owner.",
      ),
    ).toBeVisible();
    expect(within(row).getByText("u1")).toBeVisible();

    await user.type(
      within(row).getByPlaceholderText("Add owner id"),
      "u3",
    );
    await user.click(within(row).getByRole("button", { name: "Add" }));
    expect(setOwners).toHaveBeenCalledWith("connect-1", ["u1", "u2", "u3"]);

    await user.click(
      within(row).getByRole("button", { name: "Remove u1" }),
    );
    expect(setOwners).toHaveBeenCalledWith("connect-1", ["u2"]);
  });
});
