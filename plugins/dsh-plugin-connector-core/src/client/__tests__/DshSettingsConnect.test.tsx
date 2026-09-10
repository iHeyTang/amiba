import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DshSettingsConnect } from "../DshSettingsConnect";
import { createConnectorUIRegistry } from "../connector-ui-registry";
import type { ConnectWizardHost, PresetOption } from "../connector-ui-registry";
import type { ConnectorProviderView, ConnectView } from "../../types";

// Task 4: `DshSettingsConnect` now takes the wizard registry and a preset
// loader instead of building its own add-connect dialog. A fresh, empty
// registry is enough for the list/enable/remove/owners/empty tests below —
// none of them drive the add flow into a provider wizard body.
const registry = createConnectorUIRegistry();
const loadPresets = async () => [
  { id: "restricted", label: "Restricted", isDefault: true },
];

const listProviders = vi.fn();
const list = vi.fn();
const create = vi.fn();
const setEnabled = vi.fn();
const remove = vi.fn();
const setOwners = vi.fn();
const details = vi.fn();
const update = vi.fn();
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
  details,
  update,
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
    details.mockImplementation(async (id: string) => ({
      connect: connects.find((item) => item.id === id),
      settings: {},
    }));
  });

  it("lists connects with provider name, status badges, and owner counts", async () => {
    const { container } = render(
      <DshSettingsConnect
        adapter={adapter}
        loadPresets={loadPresets}
        registry={registry}
      />,
    );

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
    expect(screen.getAllByText("Lark")).toHaveLength(4);
    expect(screen.getAllByText("Webhook")).toHaveLength(2);
    expect(screen.getByText(/3 accounts/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /owners/ }),
    ).not.toBeInTheDocument();

    // Layout rule: no PaneHeaderBar/Scaffold — root is a plain flex column
    // wrapping ScrollArea, per the brief's bullet 6.
    expect(container.firstElementChild).toHaveClass(
      "flex",
      "min-h-0",
      "min-w-0",
      "flex-1",
      "flex-col",
    );

    // Visual hierarchy is carried by spacing and hover surfaces. Connector
    // entries and account rows must not regress to nested outlined cards or
    // permanent text-heavy action bars.
    const directoryCard = container.querySelector(
      '[data-connector-provider="lark"]',
    );
    expect(directoryCard).toHaveClass("bg-transparent");
    expect(directoryCard).not.toHaveClass("border");
    expect(directoryCard).not.toHaveClass("shadow-sm");
    const accountRow = screen.getByText("Sales bot").closest("button");
    expect(accountRow).not.toHaveClass("border");
    expect(
      within(accountRow!).queryByRole("button", { name: "Turn off" }),
    ).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain("text-[10px]");
    expect(container.innerHTML).not.toContain("text-[11px]");
  });

  it("shows directory and account empty states when no providers are installed", async () => {
    listProviders.mockResolvedValue([]);
    list.mockResolvedValue([]);
    render(
      <DshSettingsConnect
        adapter={adapter}
        loadPresets={loadPresets}
        registry={registry}
      />,
    );

    expect(
      await screen.findByText("No connector plugins installed"),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Install a connector plugin and it will appear here automatically.",
      ),
    ).toBeVisible();
    expect(screen.getByText("No connected accounts yet")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Add .* account/ }),
    ).not.toBeInTheDocument();
  });

  it("shows all providers on the page and opens a provider wizard directly", async () => {
    const user = userEvent.setup();
    const directoryRegistry = createConnectorUIRegistry();
    directoryRegistry.register("lark", {
      component: () => <div>lark body</div>,
    });
    listProviders.mockResolvedValue(providers);
    list.mockResolvedValue([]);
    render(
      <DshSettingsConnect
        adapter={adapter}
        loadPresets={loadPresets}
        registry={directoryRegistry}
      />,
    );

    expect(await screen.findByText("No connected accounts yet")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Add Lark account" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Add Webhook account" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Add Lark account" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("lark body")).toBeInTheDocument();
  });

  it("opens a provider detail page while keeping add-account as a direct action", async () => {
    const user = userEvent.setup();
    const detailRegistry = createConnectorUIRegistry();
    detailRegistry.register("lark", {
      component: () => <div>lark wizard</div>,
      details: () => <p>Lark provider overview</p>,
      tagline: "Connect a Feishu bot",
    });
    render(
      <DshSettingsConnect
        adapter={adapter}
        loadPresets={loadPresets}
        registry={detailRegistry}
      />,
    );

    await screen.findByText("Sales bot");
    await user.click(screen.getByRole("button", { name: "View Lark details" }));

    expect(
      screen.getByRole("heading", { level: 1, name: "Lark" }),
    ).toBeVisible();
    expect(screen.getByText("Lark provider overview")).toBeVisible();
    expect(screen.getByText("3 connected")).toBeVisible();
    expect(screen.getByText("Sales bot")).toBeVisible();
    expect(screen.queryByPlaceholderText("Search connectors")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Connectors" }));
    expect(screen.getByPlaceholderText("Search connectors")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "View Lark details" }));
    await user.click(
      screen.getByRole("button", { name: "Add another Lark account" }),
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("lark wizard")).toBeInTheDocument();
  });

  it("searches the connector directory and filters by connection state", async () => {
    const user = userEvent.setup();
    listProviders.mockResolvedValue([
      ...providers,
      {
        id: "slack",
        name: "Slack",
        description: "Team messaging connector",
        supportsOnboarding: false,
      },
    ]);
    render(
      <DshSettingsConnect
        adapter={adapter}
        loadPresets={loadPresets}
        registry={registry}
      />,
    );

    const search = await screen.findByRole("textbox", {
      name: "Search connectors",
    });
    await user.type(search, "generic json");
    expect(
      screen.getByRole("button", { name: "Add another Webhook account" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add another Lark account" }),
    ).not.toBeInTheDocument();

    await user.clear(search);
    await user.click(screen.getByRole("button", { name: "Not connected 1" }));
    expect(
      screen.getByRole("button", { name: "Add Slack account" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add another Lark account" }),
    ).not.toBeInTheDocument();
  });

  it("keeps an already-connected provider addable for another account", async () => {
    const registry = createConnectorUIRegistry();
    registry.register("lark", {
      component: () => <div>lark body</div>,
      icon: <span data-testid="lark-icon" />,
    });
    listProviders.mockResolvedValue([
      { id: "lark", name: "Lark", description: "", supportsOnboarding: false },
    ]);
    list.mockResolvedValue(
      connects.filter((connect) => connect.provider === "lark"),
    );
    const loadPresets = async () => [
      { id: "restricted", label: "Restricted", isDefault: true },
    ];
    render(
      <DshSettingsConnect
        adapter={adapter}
        registry={registry}
        loadPresets={loadPresets}
      />,
    );
    const addAnother = await screen.findByRole("button", {
      name: "Add another Lark account",
    });
    expect(addAnother).toBeEnabled();
    expect(screen.getByText("3 accounts")).toBeVisible();
    await userEvent.click(addAnother);
    expect(await screen.findByText("lark body")).toBeInTheDocument();
  });

  // The real page loads presets lazily, only once a directory card opens, so the
  // wizard chrome is already mounted (with an empty list) by the time they
  // land. The mounted body must still end up with the default preset —
  // otherwise the very first add fails with `agent_preset_required`.
  it("hands the mounted wizard body the default preset once the lazy preset load resolves", async () => {
    const registry = createConnectorUIRegistry();
    const captured: { host?: ConnectWizardHost } = {};
    registry.register("lark", {
      component: ({ host }: { host: ConnectWizardHost }) => {
        captured.host = host;
        return <div>lark body</div>;
      },
    });
    listProviders.mockResolvedValue([
      {
        id: "lark",
        name: "飞书 / Lark",
        description: "",
        supportsOnboarding: false,
      },
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
      <DshSettingsConnect
        adapter={adapter}
        loadPresets={loadPresets}
        registry={registry}
      />,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Add 飞书 / Lark account" }),
    );
    expect(await screen.findByText("lark body")).toBeInTheDocument();
    expect(captured.host?.presets.map((p) => p.id)).not.toContain("restricted");

    await act(async () => {
      resolvePresets([
        { id: "restricted", label: "Restricted", isDefault: true },
      ]);
    });
    expect(captured.host?.presets.map((p) => p.id)).toContain("restricted");
  });

  // A provider plugin's client half can finish registering its wizard after
  // this page has mounted, so the rows have to follow the registry rather than
  // snapshot it: until then the row shows the generic `Cable` fallback.
  it("swaps in a provider icon registered after the page mounted", async () => {
    const registry = createConnectorUIRegistry();
    listProviders.mockResolvedValue([
      {
        id: "lark",
        name: "飞书 / Lark",
        description: "",
        supportsOnboarding: false,
      },
    ]);
    list.mockResolvedValue([
      {
        id: "c1",
        provider: "lark",
        name: "Sales",
        enabled: true,
        pairing: false,
        owners: [],
        status: { state: "ready" },
        createdAt: "2026-08-15T00:00:00.000Z",
        updatedAt: "2026-08-15T00:00:00.000Z",
      },
    ]);
    const { container } = render(
      <DshSettingsConnect
        adapter={adapter}
        loadPresets={loadPresets}
        registry={registry}
      />,
    );

    await screen.findByText("Sales");
    expect(screen.queryByTestId("late-lark-icon")).not.toBeInTheDocument();
    expect(container.querySelector(".lucide-cable")).not.toBeNull();

    act(() => {
      registry.register("lark", {
        component: () => null,
        icon: <span data-testid="late-lark-icon" />,
      });
    });
    expect(screen.getAllByTestId("late-lark-icon")).toHaveLength(2);
  });

  it("shows the provider's registry icon on a connect row", async () => {
    const registry = createConnectorUIRegistry();
    registry.register("lark", {
      component: () => null,
      icon: <img alt="" data-testid="lark-row-icon" />,
    });
    listProviders.mockResolvedValue([
      {
        id: "lark",
        name: "飞书 / Lark",
        description: "",
        supportsOnboarding: false,
      },
    ]);
    list.mockResolvedValue([
      {
        id: "c1",
        provider: "lark",
        name: "Sales",
        enabled: true,
        pairing: false,
        owners: [],
        status: { state: "ready" },
        createdAt: "2026-08-15T00:00:00.000Z",
        updatedAt: "2026-08-15T00:00:00.000Z",
      },
    ]);
    render(
      <DshSettingsConnect
        adapter={adapter}
        registry={registry}
        loadPresets={async () => []}
      />,
    );
    const row = (await screen.findByText("Sales")).closest("button")!;
    const logoSlot = within(row).getByTestId("lark-row-icon").parentElement;
    expect(logoSlot).toHaveAttribute("data-provider-logo", "");
    expect(logoSlot).toHaveClass("[&>img]:h-full", "[&>img]:w-full");
    expect(logoSlot).not.toHaveClass("border", "bg-muted/30", "rounded-[10px]");
  });
});
