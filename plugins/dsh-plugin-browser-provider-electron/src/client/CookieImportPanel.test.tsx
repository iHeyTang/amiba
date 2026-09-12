import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CookieImportPanel } from "./CookieImportPanel.js";
vi.mock("@amiba/i18n/plugin", () => ({
  usePluginT: (messages: { en: Record<string, string> }) => ({
    t: (key: string, args: Record<string, unknown> = {}) =>
      (messages.en[key] ?? key).replace(/\{(\w+)\}/g, (_m, name) =>
        String(args[name] ?? ""),
      ),
  }),
}));
afterEach(cleanup);
const result = {
  imported: 1,
  preserved: 0,
  expired: 0,
  unsupported: 0,
  failed: 0,
};
const importer = () => ({
  sources: vi.fn(async () => ({
    supported: true,
    sources: [{ id: "profile", browser: "Chrome", profile: "Personal" }],
  })),
  sites: vi.fn(async (_id: string) => [
    { domain: "example.test", count: 3 },
    { domain: "other.test", count: 1 },
  ]),
  run: vi.fn(
    async (_id: string, _domains: string[] | null, _overwrite: boolean) =>
      result,
  ),
});
it("offers one-click import for all sites, including profiles with more than 100 websites", async () => {
  const api = importer();
  api.sites.mockResolvedValue(
    Array.from({ length: 150 }, (_, index) => ({
      domain: `site${index}.test`,
      count: 1,
    })),
  );
  const close = vi.fn();
  render(
    <CookieImportPanel importer={api} onClose={close} onVisit={() => {}} />,
  );
  await screen.findByRole("button", { name: "Chrome" });
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Search websites")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "One-click import" }));
  await screen.findByText("You're ready to browse");
  expect(api.run).toHaveBeenCalledWith("profile", null, false);
  fireEvent.click(screen.getByText("Start browsing"));
  expect(close).toHaveBeenCalledOnce();
});
it("keeps selected sites and replacement opt-in inside advanced settings", async () => {
  const api = importer();
  const visit = vi.fn();
  render(
    <CookieImportPanel importer={api} onClose={() => {}} onVisit={visit} />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Advanced settings" }),
  );
  fireEvent.click(screen.getByLabelText("Choose websites"));
  expect(screen.getByText("Import selected websites")).toBeDisabled();
  fireEvent.click(await screen.findByLabelText(/example.test/));
  fireEvent.click(screen.getByLabelText("Replace existing login data"));
  fireEvent.click(screen.getByRole("button", { name: "Advanced settings" }));
  expect(
    screen.getByText("Matching login data will be replaced"),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByText("Import selected websites"));
  await screen.findByText("You're ready to browse");
  expect(api.run).toHaveBeenCalledWith("profile", ["example.test"], true);
  fireEvent.click(screen.getByText("View import details"));
  fireEvent.click(screen.getByText("Open website"));
  expect(visit).toHaveBeenCalledWith("example.test");
});
it("ignores a stale website list after choosing another browser", async () => {
  const api = importer();
  let release!: (value: Array<{ domain: string; count: number }>) => void;
  api.sources.mockResolvedValue({
    supported: true,
    sources: [
      { id: "profile", browser: "Chrome", profile: "Personal" },
      { id: "second", browser: "Edge", profile: "Work" },
    ],
  });
  api.sites.mockImplementation((id) =>
    id === "profile"
      ? new Promise((resolve) => {
          release = resolve;
        })
      : Promise.resolve([{ domain: "work.test", count: 1 }]),
  );
  render(
    <CookieImportPanel importer={api} onClose={() => {}} onVisit={() => {}} />,
  );
  await waitFor(() => expect(api.sites).toHaveBeenCalledWith("profile"));
  fireEvent.click(screen.getByRole("button", { name: "Edge" }));
  fireEvent.click(screen.getByRole("button", { name: "Advanced settings" }));
  fireEvent.click(screen.getByLabelText("Choose websites"));
  await screen.findByText("work.test");
  release([{ domain: "private.test", count: 9 }]);
  await waitFor(() =>
    expect(screen.queryByText("private.test")).not.toBeInTheDocument(),
  );
});
it("keeps a denied import retryable without resetting selections or showing secrets", async () => {
  const api = importer();
  api.run.mockRejectedValueOnce(
    new Error("KEYCHAIN_DENIED raw-secret-must-not-render"),
  );
  render(
    <CookieImportPanel importer={api} onClose={() => {}} onVisit={() => {}} />,
  );
  await screen.findByRole("button", { name: "Chrome" });
  fireEvent.click(screen.getByText("One-click import"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Access wasn't granted",
  );
  expect(screen.queryByText(/raw-secret/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("One-click import"));
  await screen.findByText("You're ready to browse");
  expect(api.run).toHaveBeenCalledTimes(2);
});
it("does not label an empty import as success", async () => {
  const api = importer();
  api.run.mockResolvedValue({ ...result, imported: 0, failed: 2 });
  render(
    <CookieImportPanel importer={api} onClose={() => {}} onVisit={() => {}} />,
  );
  await screen.findByRole("button", { name: "Chrome" });
  fireEvent.click(screen.getByText("One-click import"));
  await screen.findByText("No login data was imported");
  expect(screen.queryByText("You're ready to browse")).not.toBeInTheDocument();
});
