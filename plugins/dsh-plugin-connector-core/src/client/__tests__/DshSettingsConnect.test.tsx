import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DshSettingsConnect } from "../DshSettingsConnect";
import type { ConnectorProviderView, ConnectView } from "../../types";

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

// Task 4 fixture: a provider that supports the scan-onboarding flow, used by
// the "scan mode" describe block below. Listed first so it becomes the
// dialog's default-selected provider.
const onboardProviders: ConnectorProviderView[] = [
  {
    id: "wecom",
    name: "WeCom",
    description: "WeCom bot connector",
    supportsOnboarding: true,
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
    // connect-2 is disabled (enabled: false) despite carrying a stale
    // { state: "connecting" } status left over from before it was turned
    // off — the badge must show a neutral "Off", not read that status.
    expect(screen.getByText("Off")).toBeVisible();
    expect(screen.queryByText("Connecting")).not.toBeInTheDocument();
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

  it("trims the app secret on submit, same as the app id", async () => {
    const user = userEvent.setup();
    create.mockResolvedValue(connectView());
    render(<DshSettingsConnect adapter={adapter} />);

    await user.click(await screen.findByRole("button", { name: /Add connect/ }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Connect name"), "Support bot");
    await user.type(within(dialog).getByLabelText("App ID"), "app-123");
    await user.type(
      within(dialog).getByLabelText("App secret"),
      "  secret-xyz  ",
    );

    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ appSecret: "secret-xyz" }),
      }),
    );
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

describe("DshSettingsConnect — scan-to-connect mode", () => {
  // Opening the dialog and typing into it use REAL timers via `userEvent`:
  // under Vitest fake timers, React 18's effect scheduling (jsdom has no
  // `MessageChannel`, so the scheduler falls back to a timer it can't run
  // without an explicit clock advance) and userEvent's own click both stall
  // past any reasonable per-test timeout, even for state driven by an
  // already-resolved mock promise — confirmed by isolated reproduction
  // before writing these tests. Fake timers are switched on only once the
  // dialog is open and the form is filled, right before the interaction
  // that starts the 1500ms poll interval (so that interval is itself a fake
  // one `advanceTimersByTimeAsync` can drive) — and every click after that
  // switch uses plain `fireEvent.click` rather than `userEvent`, since
  // userEvent's click still stalls under fake timers even with
  // `advanceTimers` configured.
  beforeEach(() => {
    vi.clearAllMocks();
    listProviders.mockResolvedValue(onboardProviders);
    list.mockResolvedValue([]);
    // Default so RTL's automatic unmount-between-tests (which fires our
    // close/unmount cleanup whenever a test leaves a session in flight)
    // always has a well-behaved promise to resolve; individual tests still
    // override this when the cancel call itself is under test.
    cancelOnboarding.mockResolvedValue({ sessionId: "unused", state: "cancelled" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function openDialogAndFillName(nameValue = "Support bot") {
    const user = userEvent.setup();
    render(<DshSettingsConnect adapter={adapter} />);
    await user.click(await screen.findByRole("button", { name: /Add connect/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Connect name"), nameValue);
    return dialog;
  }

  /** Flushes pending microtasks/effects under fake timers, optionally also
   * advancing the fake clock by `ms` (e.g. the 1500ms poll cadence). */
  async function flush(ms = 0) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("shows a scan/manual mode switch defaulting to scan mode, hiding the manual config fields", async () => {
    const dialog = await openDialogAndFillName();

    expect(
      within(dialog).getByRole("button", { name: "Scan to connect" }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Manual setup" }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Start scanning" }),
    ).toBeVisible();
    expect(
      within(dialog).queryByLabelText("Provider configuration"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Add" }),
    ).not.toBeInTheDocument();
  });

  it("does not show a mode switch for a provider without onboarding support", async () => {
    listProviders.mockResolvedValue(providers);
    const dialog = await openDialogAndFillName();

    expect(
      within(dialog).queryByRole("button", { name: "Scan to connect" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Manual setup" }),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Add" })).toBeVisible();
  });

  it("begins onboarding with the provider, name, and default agent preset", async () => {
    beginOnboarding.mockResolvedValue({ sessionId: "sess-1", state: "pending" });
    const dialog = await openDialogAndFillName();

    vi.useFakeTimers();
    fireEvent.click(within(dialog).getByRole("button", { name: "Start scanning" }));
    await flush();

    expect(beginOnboarding).toHaveBeenCalledWith({
      provider: "wecom",
      name: "Support bot",
      agentPreset: "restricted",
    });
  });

  it("renders the QR code once a poll returns a qrUrl", async () => {
    beginOnboarding.mockResolvedValue({ sessionId: "sess-2", state: "pending" });
    pollOnboarding.mockResolvedValue({
      sessionId: "sess-2",
      state: "pending",
      qrUrl: "https://example.com/qr/sess-2",
      qrExpireIn: 300,
    });
    const dialog = await openDialogAndFillName();

    vi.useFakeTimers();
    fireEvent.click(within(dialog).getByRole("button", { name: "Start scanning" }));
    await flush();
    expect(pollOnboarding).not.toHaveBeenCalled();

    await flush(1500);

    expect(pollOnboarding).toHaveBeenCalledWith("sess-2");
    const img = within(dialog).getByRole("img", { name: "Onboarding QR code" });
    expect(img.getAttribute("src")).toMatch(/^data:image\/svg/);
    expect(
      within(dialog).getByText(
        "Scan this QR code with the platform's app to authorize Amiba.",
      ),
    ).toBeVisible();
    expect(
      within(dialog).getByText(
        "This connect stays online through a persistent long connection — keep Amiba running after scanning so messages keep flowing.",
      ),
    ).toBeVisible();
  });

  it("renders the statusNote (and no QR image or error) when a pending poll has no qrUrl yet", async () => {
    beginOnboarding.mockResolvedValue({ sessionId: "sess-6", state: "pending" });
    pollOnboarding.mockResolvedValue({
      sessionId: "sess-6",
      state: "pending",
      statusNote: "contacting platform",
    });
    const dialog = await openDialogAndFillName();

    vi.useFakeTimers();
    fireEvent.click(within(dialog).getByRole("button", { name: "Start scanning" }));
    await flush();
    await flush(1500);

    expect(within(dialog).getByText("contacting platform")).toBeVisible();
    expect(within(dialog).queryByRole("img")).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText("That provider is no longer installed."),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes the dialog and refreshes the list when onboarding completes", async () => {
    beginOnboarding.mockResolvedValue({ sessionId: "sess-4", state: "pending" });
    pollOnboarding.mockResolvedValue({
      sessionId: "sess-4",
      state: "completed",
      connect: connectView({
        id: "connect-9",
        provider: "wecom",
        name: "Support bot",
      }),
    });
    const dialog = await openDialogAndFillName();
    expect(list).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    fireEvent.click(within(dialog).getByRole("button", { name: "Start scanning" }));
    await flush();
    await flush(1500);

    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a translated inline error when onboarding fails", async () => {
    beginOnboarding.mockResolvedValue({ sessionId: "sess-5", state: "pending" });
    pollOnboarding.mockResolvedValue({
      sessionId: "sess-5",
      state: "error",
      error: "provider_not_found",
    });
    const dialog = await openDialogAndFillName();

    vi.useFakeTimers();
    fireEvent.click(within(dialog).getByRole("button", { name: "Start scanning" }));
    await flush();
    await flush(1500);

    expect(
      within(dialog).getByText("That provider is no longer installed."),
    ).toBeVisible();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("cancels the onboarding session exactly once when the dialog is closed mid-flow, and stops polling", async () => {
    beginOnboarding.mockResolvedValue({ sessionId: "sess-3", state: "pending" });
    pollOnboarding.mockResolvedValue({
      sessionId: "sess-3",
      state: "pending",
      qrUrl: "https://example.com/qr/sess-3",
    });
    cancelOnboarding.mockResolvedValue({ sessionId: "sess-3", state: "cancelled" });
    const dialog = await openDialogAndFillName();

    vi.useFakeTimers();
    fireEvent.click(within(dialog).getByRole("button", { name: "Start scanning" }));
    await flush();
    await flush(1500);
    within(dialog).getByRole("img", { name: "Onboarding QR code" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await flush();

    expect(cancelOnboarding).toHaveBeenCalledTimes(1);
    expect(cancelOnboarding).toHaveBeenCalledWith("sess-3");

    pollOnboarding.mockClear();
    await flush(3000);
    expect(pollOnboarding).not.toHaveBeenCalled();
  });

  it("clears the poll interval on unmount mid-flow and issues exactly one cancel", async () => {
    beginOnboarding.mockResolvedValue({ sessionId: "sess-7", state: "pending" });
    pollOnboarding.mockResolvedValue({
      sessionId: "sess-7",
      state: "pending",
      qrUrl: "https://example.com/qr/sess-7",
    });
    cancelOnboarding.mockResolvedValue({ sessionId: "sess-7", state: "cancelled" });
    const user = userEvent.setup();
    const { unmount } = render(<DshSettingsConnect adapter={adapter} />);
    await user.click(await screen.findByRole("button", { name: /Add connect/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Connect name"), "Support bot");

    vi.useFakeTimers();
    fireEvent.click(within(dialog).getByRole("button", { name: "Start scanning" }));
    await flush();
    await flush(1500);

    unmount();
    await flush();

    expect(cancelOnboarding).toHaveBeenCalledTimes(1);
    expect(cancelOnboarding).toHaveBeenCalledWith("sess-7");

    pollOnboarding.mockClear();
    await flush(3000);
    expect(pollOnboarding).not.toHaveBeenCalled();
  });
});
