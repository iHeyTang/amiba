import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  DesktopSyncHeader,
  DesktopSyncSettings,
} from "../DesktopSyncSettings.js";
import type { ConnectAdapter } from "../adapter.js";

it("shows the destination and saves only this conversation's opt-in; explains uncertain delivery", async () => {
  const view = {
    desktopSync: {
      enabled: false,
      messages: [
        {
          id: "one",
          sourceMessageId: "input",
          sessionId: "session",
          author: "user",
          text: "User · Desktop\nhello",
          state: "failed",
          error: "sync_delivery_unconfirmed",
        },
      ],
    },
  };
  const manage = vi.fn(async (_id, _key, input) => ({
    ...view,
    desktopSync: { ...view.desktopSync, enabled: input.desktopSync ?? false },
  }));
  const adapter = { conversationSettings: manage } as unknown as ConnectAdapter;
  render(
    <DesktopSyncSettings
      adapter={adapter}
      connectId="account"
      conversationKey="chat"
      target="Work · Team"
    />,
  );
  const toggle = await screen.findByRole("switch", {
    name: "Sync desktop messages",
  });
  await waitFor(() => expect(toggle).not.toBeDisabled());
  expect(toggle).not.toBeChecked();
  expect(screen.getByText("Work · Team")).toBeInTheDocument();
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(manage).toHaveBeenCalledWith("account", "chat", {
      action: "configure",
      desktopSync: true,
    }),
  );
  await waitFor(() => expect(toggle).toBeChecked());
  expect(screen.getByText(/Delivery unconfirmed/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry sync" }));
  await waitFor(() =>
    expect(manage).toHaveBeenCalledWith("account", "chat", {
      action: "retry-sync",
    }),
  );
});

it("opens sync controls, updates the header immediately and dismisses with Escape", async () => {
  const user = userEvent.setup();
  let enabled = true;
  const adapter = {
    list: vi.fn(async () => [{ id: "account", name: "Feishu" }]),
    details: vi.fn(async () => ({
      messaging: {
        conversations: [
          { key: "chat", sessionId: "im-session", title: "Team" },
        ],
      },
    })),
    conversationSettings: vi.fn(async (_id, _key, input) => {
      if (input.action === "configure") enabled = input.desktopSync;
      return { desktopSync: { enabled, messages: [] } };
    }),
  } as unknown as ConnectAdapter;
  const { rerender } = render(
    <DesktopSyncHeader sessionId="im-session" adapter={adapter} />,
  );
  const trigger = await screen.findByRole("button", {
    name: "Message sync: Feishu · Team",
  });
  expect(trigger).toHaveTextContent("Sync to Feishu");
  await user.click(trigger);
  const toggle = await screen.findByRole("switch", {
    name: "Sync desktop messages",
  });
  await waitFor(() => expect(toggle).not.toBeDisabled());
  await user.click(toggle);
  await waitFor(() => expect(trigger).toHaveTextContent("Sync off"));
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(trigger).toHaveFocus();
  rerender(<DesktopSyncHeader sessionId="desktop-session" adapter={adapter} />);
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: /Message sync:/ }),
    ).not.toBeInTheDocument(),
  );
});
