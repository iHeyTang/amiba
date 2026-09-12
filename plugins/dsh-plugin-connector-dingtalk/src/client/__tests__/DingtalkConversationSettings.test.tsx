import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ConnectSettingsHost } from "@amiba/dsh-plugin-connector-core/client";
import { DingtalkConversationSettings } from "../DingtalkConversationSettings.js";
vi.mock("@amiba/ui/plugin", () => ({
  usePluginT: (catalog: { en: Record<string, string> }) => ({ t: (key: string) => catalog.en[key] ?? key }),
  Input: (props: any) => <input {...props} />,
  Button: ({ variant, size, children, ...props }: any) => <button {...props}>{children}</button>,
}));
afterEach(cleanup);
const view = (sessionId = "session-private-id") => ({
  access: "shared" as const, policy: { cadence: "daily" as const, timeZone: "Asia/Shanghai" },
  currentSessionId: sessionId, pendingNewConversation: false,
  history: [{ sessionId, createdAt: Date.parse("2026-09-12T08:00:00Z") }], sharedResources: [],
});
function fixture() {
  const manage = vi.fn(async (_key: string, _input: any) => view());
  const host = { connect: { id: "account", pairing: false }, settings: {}, save: vi.fn(), conversations: {
    items: [{ key: "group-private-id", kind: "group", title: "Project team", sessionId: "session-private-id" }, { key: "another-group", kind: "group", title: "Other team", sessionId: "another-session" }],
    manage, refresh: vi.fn(async () => {}),
  } } as unknown as ConnectSettingsHost;
  return { host, manage };
}
it("manages the selected chat using readable labels and opens dated history", async () => {
  const { host, manage } = fixture();
  render(<DingtalkConversationSettings host={host} />);
  const cadence = await screen.findByRole("combobox", { name: "Start a new conversation" });
  expect(manage).toHaveBeenCalledWith("group-private-id", { action: "status" });
  expect(screen.queryByText("group-private-id")).not.toBeInTheDocument();
  expect(screen.queryByText("session-private-id")).not.toBeInTheDocument();
  fireEvent.change(cadence, { target: { value: "manual" } });
  await waitFor(() => expect(manage).toHaveBeenLastCalledWith("group-private-id", { action: "configure", cadence: "manual" }));
  await waitFor(() => expect(cadence).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Start fresh with the next message" }));
  await waitFor(() => expect(manage).toHaveBeenLastCalledWith("group-private-id", { action: "new" }));
  const opened = vi.fn();
  window.addEventListener("amiba:open-session", opened);
  try {
    fireEvent.click(screen.getByText("Conversation history"));
    fireEvent.click(screen.getByText("Current").closest("button")!);
    expect(opened.mock.calls[0]![0].detail).toEqual({ sessionId: "session-private-id" });
  } finally { window.removeEventListener("amiba:open-session", opened); }
});
it("ignores a late response from the previously selected group", async () => {
  const { host, manage } = fixture();
  let resolve!: (result: ReturnType<typeof view>) => void;
  manage.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  manage.mockResolvedValueOnce(view("another-session"));
  render(<DingtalkConversationSettings host={host} />);
  fireEvent.change(screen.getByRole("combobox", { name: "Chat" }), { target: { value: "another-group" } });
  await screen.findByRole("combobox", { name: "Start a new conversation" });
  await act(async () => { resolve({ ...view(), pendingNewConversation: true }); });
  expect(screen.queryByText("The next message will start a new conversation.")).not.toBeInTheDocument();
  expect(manage).toHaveBeenLastCalledWith("another-group", { action: "status" });
});
it("shows a recoverable failure without claiming that settings were saved", async () => {
  const { host, manage } = fixture();
  manage.mockRejectedValueOnce(new Error("offline"));
  render(<DingtalkConversationSettings host={host} />);
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("combobox", { name: "Start a new conversation" });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
