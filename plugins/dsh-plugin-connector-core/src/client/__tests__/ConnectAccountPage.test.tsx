import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConnectAccountPage } from "../ConnectAccountPage.js";
import type { ConnectView } from "../../types.js";
import type { ConnectAdapter } from "../adapter.js";

const connect: ConnectView = {
  id: "a",
  name: "Work account",
  provider: "fake",
  agentPreset: "standard",
  enabled: true,
  pairing: false,
  owners: ["alice"],
  status: { state: "ready" },
  createdAt: "now",
  updatedAt: "now",
};
function props(messaging = true) {
  const details = {
    connect,
    settings: { label: "Provider setting" },
    ...(messaging
      ? {
          messaging: {
            delivery: {
              pendingInbound: 0,
              queuedOutbound: 2,
              failedOutbound: 1,
            },
            conversations: [
              { key: "thread", kind: "p2p", sessionId: "session-a" },
            ],
          },
        }
      : {}),
  };
  const adapter = {
    details: vi.fn(async () => details),
    update: vi.fn(async () => connect),
    setEnabled: vi.fn(async () => connect),
    remove: vi.fn(async () => ({ id: "a", deleted: true })),
    setOwners: vi.fn(async () => connect),
  } as unknown as ConnectAdapter;
  return {
    adapter,
    connect,
    provider: {
      id: "fake",
      name: "Fake",
      description: "",
      supportsOnboarding: false,
      ...(messaging ? { messaging: { ownerPairing: true } } : {}),
    },
    presets: [{ id: "standard", label: "Standard", isDefault: true }],
    onBack: vi.fn(),
    onChanged: vi.fn(async () => undefined),
    onRemoved: vi.fn(),
  };
}

describe("connection account page", () => {
  it("retries this connection's failed replies only after a click and refreshes delivery status", async () => {
    const p = props();
    let failed = true;
    vi.mocked(p.adapter.details).mockImplementation(async () => ({ connect, settings: {}, messaging: { conversations: [], delivery: { pendingInbound: 0, queuedOutbound: 0, failedOutbound: failed ? 1 : 0, ...(failed ? { lastDeliveryError: "offline" } : {}) } } }));
    const retry = vi.fn(async () => { failed = false; return { retried: 1 }; });
    p.adapter.retryFailedReplies = retry;
    render(<ConnectAccountPage {...p} provider={{ ...p.provider, messaging: { ownerPairing: true, sharedConversations: true } }} />);
    const button = await screen.findByRole("button", { name: "Retry failed replies" });
    expect(retry).not.toHaveBeenCalled();
    await userEvent.click(button);
    expect(retry).toHaveBeenCalledWith("a");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry failed replies" })).not.toBeInTheDocument());
  });
  it("gives shared connectors chat management without a user-ID allowlist", async () => {
    const p = props();
    const manage = vi.fn(async () => ({ access: "shared" as const, policy: { cadence: "daily" as const, timeZone: "Asia/Shanghai" }, history: [], sharedResources: [], pendingNewConversation: false }));
    p.adapter.conversationSettings = manage;
    render(<ConnectAccountPage {...p} provider={{ ...p.provider, messaging: { ownerPairing: true, sharedConversations: true } }} entry={{ component: () => null, settingsFirst: true, settings: ({ host }) => <button onClick={() => void host.conversations!.manage("thread", { action: "status" })}>View chat history</button> }} />);
    await userEvent.click(await screen.findByRole("button", { name: "View chat history" }));
    expect(manage).toHaveBeenCalledWith("a", "thread", { action: "status" });
    expect(screen.queryByRole("textbox", { name: "Allowed users" })).not.toBeInTheDocument();
    expect(document.querySelector("#connect-owners")).toBeNull();
    const diagnostics = screen.getByText("Connection diagnostics").closest("details")!;
    expect(diagnostics.open).toBe(false);
    expect(diagnostics).toContainElement(screen.getByText("session-a"));
  });
  it("refreshes and shows all affected consumers before disabling or deleting a connection", async () => {
    const p = props();
    vi.mocked(p.adapter.details).mockResolvedValue({ connect, settings: {},
      capabilityUses: [{ name: "Knowledge", capabilities: ["Read documents"] }, { name: "Search", capabilities: ["Search documents"] }] });
    render(<ConnectAccountPage {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect(p.adapter.setEnabled).not.toHaveBeenCalled();
    await screen.findByText("Knowledge");
    expect(screen.getByText("Search")).toBeInTheDocument();
    expect(p.adapter.details).toHaveBeenCalledTimes(2);
    const buttons = screen.getAllByRole("button", { name: "Turn off" });
    await userEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(p.adapter.setEnabled).toHaveBeenCalledWith("a", false));
  });
  it("edits identity and delegates provider settings through the contributed component", async () => {
    const user = userEvent.setup();
    const p = props();
    render(
      <ConnectAccountPage
        {...p}
        entry={{
          component: () => null,
          settings: ({ host }) => (
            <button onClick={() => void host.save({ label: "changed" })}>
              {String(host.settings.label)}
            </button>
          ),
        }}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "Provider setting" }),
    );
    expect(p.adapter.update).toHaveBeenCalledWith("a", {
      settings: { label: "changed" },
    });
    const name = screen.getByLabelText("Connect name");
    await user.clear(name);
    await user.type(name, "New name");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(p.adapter.update).toHaveBeenCalledWith("a", {
      name: "New name",
      agentPreset: "standard",
    });
  });
  it("keeps message diagnostics collapsed and hides the entire section for tool-only connectors", async () => {
    const p = props(false);
    render(<ConnectAccountPage {...p} />);
    await waitFor(() => expect(p.adapter.details).toHaveBeenCalledWith("a"));
    expect(screen.queryByText("Messages and access")).not.toBeInTheDocument();
    expect(screen.queryByText("Allowed users")).not.toBeInTheDocument();
  });
  it("manages owners and enablement from the account page", async () => {
    const user = userEvent.setup();
    const p = props();
    render(<ConnectAccountPage {...p} />);
    const summary = await screen.findByText("Messages and access");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    await user.click(summary);
    expect(screen.getByText("session-a")).toBeVisible();
    const owners = screen.getByLabelText("Allowed users");
    await user.clear(owners);
    await user.type(owners, "alice, bob");
    await user.click(
      screen.getByRole("button", { name: "Save allowed users" }),
    );
    expect(p.adapter.setOwners).toHaveBeenCalledWith("a", ["alice", "bob"]);
    await user.click(screen.getByRole("button", { name: "Turn off" }));
    expect(p.adapter.setEnabled).not.toHaveBeenCalled();
    await user.click(screen.getAllByRole("button", { name: "Turn off" }).at(-1)!);
    expect(p.adapter.setEnabled).toHaveBeenCalledWith("a", false);
  });
  it("requires explicit removal and shows failed writes without navigating away", async () => {
    const user = userEvent.setup();
    const p = props();
    render(<ConnectAccountPage {...p} />);
    await user.click(screen.getByRole("button", { name: "Remove connection" }));
    expect(p.adapter.remove).not.toHaveBeenCalled();
    vi.mocked(p.adapter.remove).mockRejectedValueOnce(new Error("disk_full"));
    await user.click(screen.getByRole("button", { name: "Remove connection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("disk_full");
    expect(p.onRemoved).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Remove connection" }));
    await waitFor(() => expect(p.onRemoved).toHaveBeenCalledOnce());
  });
});

it("puts provider abilities before optional account fields",async()=>{
 const p=props();const {container}=render(<ConnectAccountPage {...p} entry={{component:()=>null,settingsFirst:true,settings:()=> <h3>Work with documents</h3>}} accessPanel={<div>More work abilities</div>}/>);
 const heading=await screen.findByText("Work with documents");const name=screen.getByLabelText("Connect name");expect(name.closest("details")).not.toHaveAttribute("open");expect(heading.compareDocumentPosition(name)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(container.textContent!.indexOf("Work with documents")).toBeLessThan(container.textContent!.indexOf("More work abilities"));
});
