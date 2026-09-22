import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileMenu } from "./ProfileMenu";
import { APP_VERSION } from "../app-version";
import desktopPackage from "../../../../apps/desktop/package.json";

const updateHost = vi.hoisted(() => ({ bridge: undefined as undefined | {
  getState: ReturnType<typeof vi.fn>;
  check: ReturnType<typeof vi.fn>;
  download: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  install: ReturnType<typeof vi.fn>;
  onChanged: ReturnType<typeof vi.fn>;
} }));
const openExternal = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@amiba/app-runtime/platform", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@amiba/app-runtime/platform")>();
  return {
    ...actual,
    getPlatform: () => ({ ...actual.getPlatform(), shell: { openExternal }, appUpdates: updateHost.bridge }),
  };
});
vi.mock("./profile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./profile")>();
  return {
    ...actual,
    usePersonalProfile: () => ({
      profile: { ...actual.DEFAULT_PROFILE, nickname: "Taylor" },
    }),
  };
});
beforeEach(() => {
  openExternal.mockClear();
  updateHost.bridge = undefined;
});

async function openMenu() {
  const onOpenSettings = vi.fn();
  render(<ProfileMenu onOpenSettings={onOpenSettings} />);
  await userEvent.click(screen.getByRole("button", { name: "Profile menu" }));
  return onOpenSettings;
}

describe("Profile menu", () => {
  it("shows the identity header and settings shortcut, and closes on selection", async () => {
    const onOpenSettings = await openMenu();
    expect(screen.getAllByText("Taylor")).toHaveLength(2);
    const settings = screen.getByRole("menuitem", { name: "Settings" });
    expect(settings).toHaveTextContent(/⌘,|Ctrl\+,/);
    await userEvent.click(settings);
    expect(onOpenSettings).toHaveBeenCalledWith(undefined);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens the supplied GitHub repository through the system browser", async () => {
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "GitHub" }));
    expect(openExternal).toHaveBeenCalledWith(
      "https://github.com/iHeyTang/amiba",
    );
  });

  it("uses the desktop package version before the update bridge is available", async () => {
    await openMenu();
    expect(APP_VERSION).toBe(desktopPackage.version);
    expect(screen.getByRole("menuitem", { name: `Current version v${desktopPackage.version}` })).toBeInTheDocument();
  });

  it("explains when this build does not support updates", async () => {
    await openMenu();
    await userEvent.click(
      screen.getByRole("menuitem", {
        name: `Current version v${APP_VERSION}`,
      }),
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Check for updates" }),
    ).toHaveTextContent("Updates are unavailable in this build");
    expect(openExternal).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Profile menu" })).toHaveFocus();
  });

  it("supports arrow keys and Escape with focus returned to the trigger", async () => {
    await openMenu();
    await userEvent.keyboard("{Home}{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Settings" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Profile menu" })).toHaveFocus();
  });
});

it("checks from the existing menu and installs only once the host reports ready", async () => {
  let changed: (state: any) => void = () => {};
  updateHost.bridge = {
    getState: vi.fn().mockResolvedValue({ status: "idle", currentVersion: "1.0.0" }),
    check: vi.fn().mockResolvedValue({ status: "downloading", currentVersion: "1.0.0", version: "1.1.0", percent: 50 }),
    download: vi.fn().mockResolvedValue({ status: "downloading", currentVersion: "1.0.0", version: "1.1.0", percent: 50 }),
    cancel: vi.fn().mockResolvedValue({ status: "cancelled", currentVersion: "1.0.0", version: "1.1.0" }),
    install: vi.fn().mockResolvedValue(undefined),
    onChanged: vi.fn(listener => { changed = listener; return () => {}; }),
  };
  await openMenu();
  await userEvent.click(screen.getByRole("menuitem", { name: "Current version v1.0.0" }));
  expect(updateHost.bridge.check).toHaveBeenCalledTimes(1);
  act(() => changed({ status: "downloading", currentVersion: "1.0.0", version: "1.1.0", percent: 50 }));
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  expect(screen.getByText("50%")).toBeInTheDocument();
  expect(screen.getByText("v1.0.0")).toBeInTheDocument();
  expect(screen.getByText("v1.1.0")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Restart and install" })).not.toBeInTheDocument();
  act(() => changed({ status: "downloaded", currentVersion: "1.0.0", version: "1.1.0", percent: 100 }));
  await userEvent.click(screen.getByRole("button", { name: "Restart and install" }));
  expect(updateHost.bridge.install).toHaveBeenCalledTimes(1);
});

it("downloads on request and hands a verified installer over for manual installation", async () => {
  let changed: (state: any) => void = () => {};
  updateHost.bridge = {
    getState: vi.fn().mockResolvedValue({ status: "idle", currentVersion: "1.0.0" }),
    check: vi.fn().mockResolvedValue({ status: "offered", currentVersion: "1.0.0", version: "1.1.0" }),
    download: vi.fn().mockResolvedValue({ status: "downloading", currentVersion: "1.0.0", version: "1.1.0", percent: 0 }),
    cancel: vi.fn().mockResolvedValue({ status: "cancelled", currentVersion: "1.0.0", version: "1.1.0" }),
    install: vi.fn().mockResolvedValue(undefined),
    onChanged: vi.fn(listener => { changed = listener; return () => {}; }),
  };
  await openMenu();
  await userEvent.click(screen.getByRole("menuitem", { name: "Current version v1.0.0" }));
  // An offered update must not download itself; the user spends the bandwidth.
  expect(updateHost.bridge.download).not.toHaveBeenCalled();
  act(() => changed({ status: "offered", currentVersion: "1.0.0", version: "1.1.0" }));
  expect(screen.getByText("Version 1.1.0 is available. Download the installer to install it yourself.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Download installer" }));
  expect(updateHost.bridge.download).toHaveBeenCalledTimes(1);
  act(() => changed({ status: "ready", currentVersion: "1.0.0", version: "1.1.0", percent: 100 }));
  expect(screen.getByText("Amiba will quit and open the installer. Complete the update in that window.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Check for updates" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Open installer" }));
  expect(updateHost.bridge.install).toHaveBeenCalledTimes(1);
});

it("shows background update discovery and keeps downloading after closing the dialog", async () => {
  let changed: (state: any) => void = () => {};
  const state = { status: "offered", currentVersion: "1.0.0", version: "1.1.0" };
  updateHost.bridge = {
    getState: vi.fn().mockResolvedValue(state),
    check: vi.fn().mockResolvedValue(state),
    download: vi.fn().mockResolvedValue(state),
    cancel: vi.fn().mockResolvedValue(state),
    install: vi.fn().mockResolvedValue(undefined),
    onChanged: vi.fn(listener => { changed = listener; return () => {}; }),
  };
  render(<ProfileMenu onOpenSettings={vi.fn()} />);
  await userEvent.click(await screen.findByRole("button", { name: "Update available" }));
  expect(updateHost.bridge.check).not.toHaveBeenCalled();
  expect(screen.queryByText("The download will start automatically.")).not.toBeInTheDocument();
  act(() => changed({ ...state, status: "downloading", percent: 46 }));
  expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Check for updates" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(updateHost.bridge.cancel).not.toHaveBeenCalled();
  const trigger = screen.getByRole("button", { name: "Downloading update · 46%" });
  expect(trigger).toHaveFocus();
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole("button", { name: "Cancel download" }));
  expect(updateHost.bridge.cancel).toHaveBeenCalledTimes(1);
  act(() => changed({ ...state, status: "cancelled" }));
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Download again" }));
  expect(updateHost.bridge.download).toHaveBeenCalledTimes(1);
});
