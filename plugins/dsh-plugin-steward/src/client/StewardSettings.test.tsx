import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ConversationView } from "@amiba/dsh-plugin-session-features";
import { StewardSettings } from "./StewardSettings.js";

vi.mock("@amiba/ui/plugin", async importOriginal => ({
  ...await importOriginal<typeof import("@amiba/ui/plugin")>(),
  usePluginT: (catalog: { en: Record<string, string> }) => ({ t: (key: string) => catalog.en[key] ?? key }),
}));
afterEach(cleanup);
const snapshot = (): ConversationView => ({
  policy: { cadence: "daily", timeZone: "Asia/Shanghai" },
  currentSessionId: "private-session-id",
  pendingNewConversation: false,
  history: [{ sessionId: "private-session-id", createdAt: Date.parse("2026-09-12T08:00:00Z") }],
  sharedResources: [],
});

it("loads when settings opens, changes cadence, and opens dated history without displaying raw IDs", async () => {
  const settings = vi.fn(async () => snapshot());
  const openSession = vi.fn();
  render(<StewardSettings settings={settings} openSession={openSession} />);
  const select = await screen.findByRole("combobox");
  expect(settings).toHaveBeenCalledWith({ action: "status" });
  expect(screen.queryByText("private-session-id")).not.toBeInTheDocument();
  settings.mockResolvedValueOnce({ ...snapshot(), policy: { cadence: "weekly", timeZone: "Asia/Shanghai" } });
  fireEvent.change(select, { target: { value: "weekly" } });
  await waitFor(() => expect(select).toHaveValue("weekly"));
  expect(settings).toHaveBeenLastCalledWith({ action: "configure", cadence: "weekly" });
  fireEvent.click(screen.getByText("Current").closest("button")!);
  expect(openSession).toHaveBeenCalledWith("private-session-id");
});

it("requests a new conversation without navigating or creating one from the UI", async () => {
  const settings = vi.fn(async () => snapshot());
  const openSession = vi.fn();
  render(<StewardSettings settings={settings} openSession={openSession} />);
  const button = await screen.findByRole("button", { name: "Start fresh with the next message" });
  settings.mockResolvedValueOnce({ ...snapshot(), pendingNewConversation: true });
  fireEvent.click(button);
  await screen.findByText("Your next message will start a new conversation.");
  expect(settings).toHaveBeenLastCalledWith({ action: "new" });
  expect(openSession).not.toHaveBeenCalled();
  expect(button).toBeDisabled();
});

it("keeps the persisted selection after a rejected update and offers retry", async () => {
  const settings = vi.fn(async () => snapshot());
  render(<StewardSettings settings={settings} openSession={vi.fn()} />);
  const select = await screen.findByRole("combobox");
  settings.mockRejectedValueOnce(new Error("offline"));
  fireEvent.change(select, { target: { value: "manual" } });
  await screen.findByRole("alert");
  expect(select).toHaveValue("daily");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry" })); });
  expect(settings).toHaveBeenLastCalledWith({ action: "status" });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
