import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DesktopSyncSettings } from "../DesktopSyncSettings.js";
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
  const toggle = await screen.findByRole("checkbox", {
    name: "Sync desktop messages",
  });
  await waitFor(() => expect(toggle).not.toBeDisabled());
  expect(toggle).not.toBeChecked();
  expect(screen.getByText("Sync to: Work · Team")).toBeInTheDocument();
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
