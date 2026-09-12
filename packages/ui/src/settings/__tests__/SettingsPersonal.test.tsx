import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPlatform } from "@amiba/app-runtime/platform";
import { SettingsPersonal } from "../SettingsPersonal";
import {
  DEFAULT_PROFILE,
  PROFILE_STORAGE_KEY,
  normalizeProfile,
  readUploadedAvatar,
  usePersonalProfile,
} from "../../profile/profile";
import { PROFILE_AVATARS } from "../../profile/avatars";

function ProfileObserver() {
  const { profile } = usePersonalProfile();
  return (
    <output data-testid="profile-observer">
      {profile.nickname}:{profile.avatar}
    </output>
  );
}

beforeEach(() => {
  const storage = getPlatform().storage;
  let value: unknown = { nickname: "Taylor", avatar: PROFILE_AVATARS[0].id };
  const listeners = new Set<(changes: any) => void>();
  vi.spyOn(storage, "get").mockImplementation(async () => ({
    [PROFILE_STORAGE_KEY]: value,
  }));
  vi.spyOn(storage, "watch").mockImplementation((_keys, callback) => {
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  });
  vi.spyOn(storage, "set").mockImplementation(async (items) => {
    value = items[PROFILE_STORAGE_KEY];
    listeners.forEach((listener) =>
      listener({ [PROFILE_STORAGE_KEY]: { newValue: value } }),
    );
  });
});
afterEach(() => vi.restoreAllMocks());

describe("Personal settings", () => {
  it("replaces the entire batch without changing or saving the selected profile", async () => {
    render(<SettingsPersonal />);
    const input = await screen.findByDisplayValue("Taylor");
    fireEvent.change(input, { target: { value: "Alex" } });
    await userEvent.click(screen.getByRole("button", { name: "Cassowary" }));
    const preview = screen
      .getByRole("img", { name: "Avatar" })
      .getAttribute("src");
    const group = screen.getByRole("group", { name: "Avatar" });
    const sources = () =>
      Array.from(group.querySelectorAll("img"), (image) =>
        image.getAttribute("src"),
      );
    let previous = sources();
    for (let batch = 0; batch < 3; batch++) {
      await userEvent.click(
        screen.getByRole("button", { name: "Another batch" }),
      );
      const next = sources();
      expect(next).toHaveLength(12);
      expect(new Set(next).size).toBe(12);
      expect(next.some((src) => previous.includes(src))).toBe(false);
      previous = next;
    }
    expect(input).toHaveValue("Alex");
    expect(screen.getByRole("img", { name: "Avatar" })).toHaveAttribute(
      "src",
      preview,
    );
    expect(getPlatform().storage.set).not.toHaveBeenCalled();
    await userEvent.click(within(group).getAllByRole("button")[0]);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Saved");
    const selected = PROFILE_AVATARS.find(
      (avatar) => avatar.src === previous[0],
    );
    expect(getPlatform().storage.set).toHaveBeenCalledWith({
      [PROFILE_STORAGE_KEY]: { nickname: "Alex", avatar: selected?.id },
    });
  });

  it("persists nickname and selected avatar, notifies other mounted consumers, and restores on remount", async () => {
    const user = userEvent.setup();
    const view = render(
      <>
        <SettingsPersonal />
        <ProfileObserver />
      </>,
    );
    const input = await screen.findByDisplayValue("Taylor");
    await user.clear(input);
    await user.type(input, "  Alex  ");
    await user.click(screen.getByRole("button", { name: "Cassowary" }));
    expect(getPlatform().storage.set).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Saved");
    expect(screen.getByTestId("profile-observer")).toHaveTextContent(
      `Alex:${PROFILE_AVATARS[1].id}`,
    );
    view.unmount();
    render(<SettingsPersonal />);
    expect(await screen.findByDisplayValue("Alex")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cassowary" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("keeps the saved profile unchanged and offers retry when storage fails", async () => {
    vi.mocked(getPlatform().storage.set).mockRejectedValueOnce(
      new Error("disk full"),
    );
    render(
      <>
        <SettingsPersonal />
        <ProfileObserver />
      </>,
    );
    const input = await screen.findByDisplayValue("Taylor");
    fireEvent.change(input, { target: { value: "Alex" } });
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save",
    );
    expect(screen.getByTestId("profile-observer")).toHaveTextContent("Taylor:");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  it("reports unreadable or oversized uploads without changing the draft", async () => {
    render(<SettingsPersonal />);
    await screen.findByDisplayValue("Taylor");
    const original = screen
      .getByRole("img", { name: "Avatar" })
      .getAttribute("src");
    fireEvent.change(screen.getByLabelText("Upload avatar"), {
      target: {
        files: [new File(["bad"], "bad.svg", { type: "image/svg+xml" })],
      },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose a valid",
    );
    expect(screen.getByRole("img", { name: "Avatar" })).toHaveAttribute(
      "src",
      original,
    );
    expect(getPlatform().storage.set).not.toHaveBeenCalled();
    await expect(
      readUploadedAvatar(
        new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", {
          type: "image/png",
        }),
      ),
    ).rejects.toThrow();
  });

  it("decodes uploads, center-crops to 256 pixels, and releases the temporary URL", async () => {
    const create = vi.fn(() => "blob:avatar");
    const revoke = vi.fn();
    vi.stubGlobal(
      "URL",
      Object.assign(class extends URL {}, {
        createObjectURL: create,
        revokeObjectURL: revoke,
      }),
    );
    vi.spyOn(Image.prototype, "naturalWidth", "get").mockReturnValue(800);
    vi.spyOn(Image.prototype, "naturalHeight", "get").mockReturnValue(400);
    Object.defineProperty(Image.prototype, "decode", {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    const draw = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: draw,
    } as any);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,YQ==",
    );
    try {
      expect(
        await readUploadedAvatar(
          new File(["image"], "avatar.png", { type: "image/png" }),
        ),
      ).toBe("data:image/png;base64,YQ==");
      expect(draw).toHaveBeenCalledWith(
        expect.any(Image),
        200,
        0,
        400,
        400,
        0,
        0,
        256,
        256,
      );
      expect(revoke).toHaveBeenCalledWith("blob:avatar");
    } finally {
      vi.unstubAllGlobals();
      delete (Image.prototype as any).decode;
    }
  });

  it("does not allow overwriting a profile that failed to load", async () => {
    vi.mocked(getPlatform().storage.get).mockRejectedValueOnce(
      new Error("unavailable"),
    );
    render(<SettingsPersonal />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load",
    );
    expect(screen.getByLabelText("Nickname")).toBeDisabled();
  });

  it("falls back safely for stale or malformed stored profile data", () => {
    expect(normalizeProfile(null)).toEqual(DEFAULT_PROFILE);
    expect(
      normalizeProfile({ nickname: 42, avatar: "javascript:alert(1)" }),
    ).toEqual(DEFAULT_PROFILE);
    expect(
      normalizeProfile({
        nickname: "  Alex  ",
        avatar: "data:image/png;base64,YQ==",
      }),
    ).toEqual({ nickname: "Alex", avatar: "data:image/png;base64,YQ==" });
  });
});
