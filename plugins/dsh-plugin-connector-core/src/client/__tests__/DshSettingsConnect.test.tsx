import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DshSettingsConnect } from "../DshSettingsConnect";
import { createConnectWizardRegistry } from "../wizard-registry";
import type { ConnectWizardHost, PresetOption } from "../wizard-registry";
import type { ConnectorProviderView, ConnectView } from "../../types";

// Task 4: `DshSettingsConnect` now takes the wizard registry and a preset
// loader instead of building its own add-connect dialog. A fresh, empty
// registry is enough for the list/enable/remove/owners/empty tests below —
// none of them drive the add flow into a provider wizard body.
const registry = createConnectWizardRegistry();
const loadPresets = async () => [
  { id: "restricted", label: "Restricted", isDefault: true },
];

const listProviders = vi.fn();
const list = vi.fn();
const create = vi.fn();
const setEnabled = vi.fn();
const remove = vi.fn();
const setOwners = vi.fn();
// `ConnectAdapter` (Task 2) gained the onboarding trio; Task 4 is where
// `DshSettingsConnect` starts calling them (scan mode in the add-connect
// dialog) — see the "scan mode" describe block below.
const beginOnboarding = vi.fn();
const pollOnboarding = vi.fn();
const cancelOnboarding = vi.fn();

const adapter = {
  listProviders,
  list,
  create,
  setEnabled,
  remove,
  setOwners,
  beginOnboarding,
  pollOnboarding,
  cancelOnboarding,
};

const providers: ConnectorProviderView[] = [
  {
    id: "lark",
    name: "Lark",
    description: "Feishu/Lark bot connector",
    supportsOnboarding: false,
  },
  {
    id: "webhook",
    name: "Webhook",
    description: "Generic JSON webhook",
    supportsOnboarding: false,
  },
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
    // Server-driven: the center reports `off` for any disabled connect
    // (see ConnectorCenter#computeStatus), so the badge just renders
    // whatever the server says — no client-side `!enabled` special case.
    status: { state: "off" },
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
  {
    id: "connect-4",
    provider: "lark",
    name: "Partial bot",
    enabled: true,
    pairing: false,
    owners: ["u4"],
    status: { state: "degraded", detail: "mcp_manager_unavailable" },
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
    const { container } = render(<DshSettingsConnect adapter={adapter} loadPresets={loadPresets} registry={registry} />);

    expect(await screen.findByText("Sales bot")).toBeVisible();
    expect(screen.getByText("Ready")).toBeVisible();
    // connect-2's { state: "off" } status is server-driven (the center
    // reports off for any disabled connect) — the badge just renders it
    // directly, no client-side `!enabled` special case.
    expect(screen.getByText("Off")).toBeVisible();
    expect(screen.queryByText("Connecting")).not.toBeInTheDocument();
    expect(screen.getByText("Error: invalid token")).toBeVisible();
    // connect-4: a degraded status (e.g. the mcp soft-skip) renders its own
    // badge variant with the detail text, distinct from both ready and error.
    expect(screen.getByText("Degraded: mcp_manager_unavailable")).toBeVisible();
    expect(screen.getAllByText("Lark")).toHaveLength(3);
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
    render(<DshSettingsConnect adapter={adapter} loadPresets={loadPresets} registry={registry} />);

    expect(await screen.findByText("No connects yet")).toBeVisible();
    expect(
      screen.getByText(
        "Install a platform plugin (for example Lark) to add a connect.",
      ),
    ).toBeVisible();
    // Two "Add connect" buttons render here: the header button and the
    // empty state's own CTA — both must be disabled when there are no
    // providers.
    const addButtons = screen.getAllByRole("button", { name: /Add connect/ });
    expect(addButtons).toHaveLength(2);
    for (const button of addButtons) {
      expect(button).toBeDisabled();
    }
  });

  it("shows the empty state with an enabled, reachable add flow when providers exist but there are no connects yet", async () => {
    const user = userEvent.setup();
    listProviders.mockResolvedValue(providers);
    list.mockResolvedValue([]);
    render(<DshSettingsConnect adapter={adapter} loadPresets={loadPresets} registry={registry} />);

    expect(await screen.findByText("No connects yet")).toBeVisible();
    expect(
      screen.queryByText(
        "Install a platform plugin (for example Lark) to add a connect.",
      ),
    ).not.toBeInTheDocument();
    // Two "Add connect" buttons render here: the header button and the
    // empty state's own CTA — both must be enabled and reach the same
    // wizard modal.
    const addButtons = screen.getAllByRole("button", { name: /Add connect/ });
    expect(addButtons).toHaveLength(2);
    for (const button of addButtons) {
      expect(button).toBeEnabled();
    }

    await user.click(addButtons[1]!);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("toggles enabled state through adapter.setEnabled and refreshes", async () => {
    const user = userEvent.setup();
    setEnabled.mockResolvedValue(connectView({ enabled: false }));
    render(<DshSettingsConnect adapter={adapter} loadPresets={loadPresets} registry={registry} />);

    await screen.findByText("Sales bot");
    const row = screen.getByText("Sales bot").closest("article")!;
    await user.click(within(row).getByRole("button", { name: "Turn off" }));

    expect(setEnabled).toHaveBeenCalledWith("connect-1", false);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("removes a connect only after confirming", async () => {
    const user = userEvent.setup();
    remove.mockResolvedValue({ id: "connect-1", deleted: true });
    render(<DshSettingsConnect adapter={adapter} loadPresets={loadPresets} registry={registry} />);

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
    render(<DshSettingsConnect adapter={adapter} loadPresets={loadPresets} registry={registry} />);

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

  it("opens the wizard modal from the add button and shows the registered provider", async () => {
    const registry = createConnectWizardRegistry();
    registry.register("lark", { component: () => <div>lark body</div>, icon: <span data-testid="lark-icon" /> });
    listProviders.mockResolvedValue([{ id: "lark", name: "飞书 / Lark", description: "", supportsOnboarding: false }]);
    list.mockResolvedValue([]);
    const loadPresets = async () => [{ id: "restricted", label: "Restricted", isDefault: true }];
    render(<DshSettingsConnect adapter={adapter} registry={registry} loadPresets={loadPresets} />);
    // Two "添加连接" / "Add connect" buttons render once the empty state's
    // own CTA exists alongside the header add button — click the first one.
    await userEvent.click((await screen.findAllByText(/添加连接|Add connect/))[0]!);
    expect(await screen.findByText("飞书 / Lark")).toBeInTheDocument();
  });

  // The real page loads presets lazily, only once `adding` flips true, so the
  // wizard chrome is already mounted (with an empty list) by the time they
  // land. The mounted body must still end up with the default preset —
  // otherwise the very first add fails with `agent_preset_required`.
  it("hands the mounted wizard body the default preset once the lazy preset load resolves", async () => {
    const registry = createConnectWizardRegistry();
    const captured: { agentPreset?: string } = {};
    registry.register("lark", {
      component: ({ host }: { host: ConnectWizardHost }) => {
        captured.agentPreset = host.agentPreset;
        return <div>lark body</div>;
      },
    });
    listProviders.mockResolvedValue([
      { id: "lark", name: "飞书 / Lark", description: "", supportsOnboarding: false },
    ]);
    list.mockResolvedValue([]);
    let resolvePresets!: (list: PresetOption[]) => void;
    const loadPresets = vi.fn(
      () =>
        new Promise<PresetOption[]>((resolve) => {
          resolvePresets = resolve;
        }),
    );
    render(
      <DshSettingsConnect adapter={adapter} loadPresets={loadPresets} registry={registry} />,
    );

    await userEvent.click((await screen.findAllByText(/添加连接|Add connect/))[0]!);
    await userEvent.click(await screen.findByText("飞书 / Lark"));
    expect(await screen.findByText("lark body")).toBeInTheDocument();
    expect(captured.agentPreset).toBe("");

    await act(async () => {
      resolvePresets([{ id: "restricted", label: "Restricted", isDefault: true }]);
    });
    expect(captured.agentPreset).toBe("restricted");
  });

  it("shows the provider's registry icon on a connect row", async () => {
    const registry = createConnectWizardRegistry();
    registry.register("lark", { component: () => null, icon: <span data-testid="lark-row-icon" /> });
    listProviders.mockResolvedValue([{ id: "lark", name: "飞书 / Lark", description: "", supportsOnboarding: false }]);
    list.mockResolvedValue([{
      id: "c1", provider: "lark", name: "Sales", enabled: true, pairing: false,
      owners: [], status: { state: "ready" }, createdAt: "2026-08-15T00:00:00.000Z", updatedAt: "2026-08-15T00:00:00.000Z",
    }]);
    render(<DshSettingsConnect adapter={adapter} registry={registry} loadPresets={async () => []} />);
    expect(await screen.findByTestId("lark-row-icon")).toBeInTheDocument();
  });
});
