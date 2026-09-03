import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SessionsListView } from "../SessionsListView";
import type { SessionListFilter } from "../session-list-extensions";

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

describe("SessionsListView filters", () => {
  const stewardFilter: SessionListFilter = {
    id: "steward",
    label: "Steward",
    test: (session) => session.source === "steward",
  };

  it("does not render a filter row when no filters are supplied", () => {
    setup();
    expect(screen.queryByTestId("session-filter-row")).not.toBeInTheDocument();
  });

  it("renders one chip per filter, defaulting to the unset state", () => {
    setup({ filters: [stewardFilter] });
    const chip = screen.getByTestId("session-filter-chip");
    expect(chip).toHaveTextContent("Steward");
    expect(chip).toHaveAttribute("data-state", "unset");
    expect(chip).toHaveAttribute("aria-pressed", "false");
  });

  it("cycles null -> true -> false -> null and filters rows accordingly", async () => {
    setup({ filters: [stewardFilter] });
    expect(screen.getByText("First chat")).toBeInTheDocument();
    expect(screen.getByText("Second chat")).toBeInTheDocument();
    expect(screen.getByText("Third chat")).toBeInTheDocument();

    const chip = screen.getByTestId("session-filter-chip");

    // null -> true: only steward-sourced sessions remain.
    await userEvent.click(chip);
    expect(chip).toHaveAttribute("data-state", "include");
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip).toHaveTextContent("✓ Steward");
    expect(screen.getByText("First chat")).toBeInTheDocument();
    expect(screen.queryByText("Second chat")).not.toBeInTheDocument();
    expect(screen.getByText("Third chat")).toBeInTheDocument();

    // true -> false: only non-steward sessions remain.
    await userEvent.click(chip);
    expect(chip).toHaveAttribute("data-state", "exclude");
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(chip).toHaveTextContent("✕ Steward");
    expect(screen.queryByText("First chat")).not.toBeInTheDocument();
    expect(screen.getByText("Second chat")).toBeInTheDocument();
    expect(screen.queryByText("Third chat")).not.toBeInTheDocument();

    // false -> null: everything is back.
    await userEvent.click(chip);
    expect(chip).toHaveAttribute("data-state", "unset");
    expect(chip).toHaveTextContent("Steward");
    expect(screen.getByText("First chat")).toBeInTheDocument();
    expect(screen.getByText("Second chat")).toBeInTheDocument();
    expect(screen.getByText("Third chat")).toBeInTheDocument();
  });
});
