import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  CASCADE_MENU_MAX_DEPTH,
  CascadeMenu,
  type CascadeMenuItem,
} from "../cascade-menu";

describe("CascadeMenu", () => {
  it("opens children in a separate side menu while keeping the parent open", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <CascadeMenu
        ariaLabel="Task actions"
        trigger={<button type="button">More</button>}
        items={[
          { id: "select", label: "Select tasks" },
          {
            id: "layout",
            label: "Display mode",
            children: [
              { id: "time", label: "By time", checked: true },
              {
                id: "workspace",
                label: "By workspace",
                checked: false,
                onSelect,
              },
            ],
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "More" }));
    await user.hover(screen.getByRole("menuitem", { name: "Display mode" }));

    expect(screen.getAllByRole("menu")).toHaveLength(2);
    expect(
      screen.getByRole("menuitem", { name: "Select tasks" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitemradio", { name: "By time" }),
    ).toHaveAttribute("aria-checked", "true");

    await user.click(
      screen.getByRole("menuitemradio", { name: "By workspace" }),
    );
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("renders at most five simultaneous menu levels", async () => {
    const user = userEvent.setup();
    let branch: CascadeMenuItem = { id: "6", label: "Level 6" };
    for (let depth = 5; depth >= 1; depth -= 1) {
      branch = {
        id: String(depth),
        label: `Level ${depth}`,
        children: [branch],
      };
    }

    render(
      <CascadeMenu
        ariaLabel="Deep actions"
        trigger={<button type="button">Open deep menu</button>}
        items={[branch]}
        maxDepth={CASCADE_MENU_MAX_DEPTH + 10}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open deep menu" }));
    for (let depth = 1; depth < CASCADE_MENU_MAX_DEPTH; depth += 1) {
      await user.click(
        screen.getByRole("menuitem", { name: `Level ${depth}` }),
      );
    }

    expect(screen.getAllByRole("menu")).toHaveLength(CASCADE_MENU_MAX_DEPTH);
    expect(
      screen.getByRole("menuitem", {
        name: `Level ${CASCADE_MENU_MAX_DEPTH}`,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Level 6")).not.toBeInTheDocument();
  });

  it("keeps only one menu open inside an exclusive group", async () => {
    const user = userEvent.setup();
    render(
      <>
        <CascadeMenu
          ariaLabel="First actions"
          exclusiveGroup="row-actions"
          trigger={<button type="button">First more</button>}
          items={[{ id: "first", label: "First action" }]}
        />
        <CascadeMenu
          ariaLabel="Second actions"
          exclusiveGroup="row-actions"
          trigger={<button type="button">Second more</button>}
          items={[{ id: "second", label: "Second action" }]}
        />
      </>,
    );

    const first = screen.getByRole("button", { name: "First more" });
    const second = screen.getByRole("button", { name: "Second more" });
    await user.click(first);
    expect(first).toHaveAttribute("aria-expanded", "true");

    await user.click(second);
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(second).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("menu", { name: "First actions" })).toBeNull();
    expect(
      screen.getByRole("menu", { name: "Second actions" }),
    ).toBeInTheDocument();
  });
});
