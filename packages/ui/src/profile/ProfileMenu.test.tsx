import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileMenu } from "./ProfileMenu";
import { APP_VERSION } from "../app-version";

const openExternal = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@amiba/app-runtime/platform", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@amiba/app-runtime/platform")>();
  return {
    ...actual,
    getPlatform: () => ({ ...actual.getPlatform(), shell: { openExternal } }),
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

  it("shows an honest placeholder when clicking the current version", async () => {
    await openMenu();
    await userEvent.click(
      screen.getByRole("menuitem", {
        name: `Current version v${APP_VERSION}`,
      }),
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Check for updates" }),
    ).toHaveTextContent("Update checking is not available yet");
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
