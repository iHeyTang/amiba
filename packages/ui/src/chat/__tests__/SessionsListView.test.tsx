import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SessionsListView } from "../SessionsListView";
import type { SessionListMenuItem } from "../session-list-extensions";

function setup(overrides: Partial<React.ComponentProps<typeof SessionsListView>> = {}) {
  const props: React.ComponentProps<typeof SessionsListView> = {
    sessions: [
      { id: "s1", title: "First chat", createdAt: 1, updatedAt: 3, source: "steward" },
      { id: "s2", title: "Second chat", createdAt: 1, updatedAt: 2 },
      { id: "s3", title: "Third chat", createdAt: 1, updatedAt: 1, source: "steward" },
    ],
    activeId: "",
    ready: true,
    query: "",
    onOpen: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(<SessionsListView {...props} />);
  return props;
}

describe("SessionsListView badges", () => {
  it("renders a chip per resolved badge, after the row title", () => {
    setup({
      itemBadges: (session) => (session.source === "steward" ? ["Steward"] : []),
    });
    const chips = screen.getAllByTestId("session-badge");
    expect(chips.map((chip) => chip.textContent)).toEqual(["Steward", "Steward"]);
    // s2 has no badge.
    const secondRow = screen.getByText("Second chat").closest("button");
    expect(secondRow?.querySelector('[data-testid="session-badge"]')).toBeNull();
  });

  it("renders nothing when itemBadges is absent", () => {
    setup();
    expect(screen.queryByTestId("session-badge")).not.toBeInTheDocument();
  });
});

describe("SessionsListView menu items", () => {
  function rowFor(title: string) {
    return screen.getByText(title).closest(".group") as HTMLElement;
  }

  async function openRowMenu(user: ReturnType<typeof userEvent.setup>, title: string) {
    const row = rowFor(title);
    await user.click(
      within(row).getByRole("button", { name: "More actions" }),
    );
  }

  it("appends a visible plugin item after the built-ins with a separator", async () => {
    const user = userEvent.setup();
    const item: SessionListMenuItem = {
      id: "hand-off",
      label: "Hand off",
      run: vi.fn(),
    };
    setup({ itemMenuItems: [item] });
    await openRowMenu(user, "First chat");

    const menuitems = screen.getAllByRole("menuitem");
    expect(menuitems.at(-1)).toHaveTextContent("Hand off");
    expect(screen.getAllByRole("separator")).toHaveLength(1);
  });

  it("hides the item for a row where visible returns false", async () => {
    const user = userEvent.setup();
    const item: SessionListMenuItem = {
      id: "hidden",
      label: "Hidden",
      visible: () => false,
      run: vi.fn(),
    };
    setup({ itemMenuItems: [item] });
    await openRowMenu(user, "First chat");

    expect(
      screen.queryByRole("menuitem", { name: "Hidden" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });

  it("calls run with the row's session on click", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    setup({ itemMenuItems: [{ id: "hand-off", label: "Hand off", run }] });
    await openRowMenu(user, "First chat");
    await user.click(screen.getByRole("menuitem", { name: "Hand off" }));

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1", title: "First chat" }),
    );
  });

  it("logs instead of throwing when run rejects", async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const run = vi.fn(() => Promise.reject(new Error("boom")));
    setup({ itemMenuItems: [{ id: "hand-off", label: "Hand off", run }] });
    await openRowMenu(user, "First chat");
    await user.click(screen.getByRole("menuitem", { name: "Hand off" }));

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());
    consoleError.mockRestore();
  });
});
