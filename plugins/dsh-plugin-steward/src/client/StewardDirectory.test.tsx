import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StewardDirectory, type DirectoryProps } from "./StewardDirectory.js";
import type { StewardInstance } from "../registry-store.js";
vi.mock("./StewardSettings.js", () => ({
  StewardSettings: () => <div>Conversation settings</div>,
}));
afterEach(cleanup);
function props(initial: StewardInstance[] = []): DirectoryProps {
  let rows = initial;
  return {
    list: vi.fn(async () => rows),
    save: vi.fn(async (input) => {
      const item = {
        ...input,
        id: input.id ?? "new",
        sessionIds: [],
        state: { version: 1 as const, tasks: [] },
      };
      rows = [...rows.filter((row) => row.id !== item.id), item];
      return item;
    }),
    remove: vi.fn(async (id) => {
      rows = rows.filter((row) => row.id !== id);
    }),
    open: vi.fn(async () => {}),
    openSession: vi.fn(),
    settings: vi.fn(),
  };
}
it("explains the zero state and creates an editable entry with an open action", async () => {
  document.documentElement.lang = "en";
  const p = props();
  render(<StewardDirectory {...p} />);
  await screen.findByText(
    "No stewards yet. Create one or start an ordinary conversation.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Create steward" }));
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Research" },
  });
  fireEvent.change(screen.getByLabelText("Responsibilities"), {
    target: { value: "Organize research" },
  });
  fireEvent.change(screen.getByLabelText("Background"), {
    target: { value: "Initial topic" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create steward" }));
  const open = await screen.findByRole("button", { name: "Open Research" });
  await waitFor(() => expect(open).not.toBeDisabled());
  expect(p.save).toHaveBeenCalledWith({
    name: "Research",
    responsibilities: "Organize research",
    background: "Initial topic",
    context: "",
  });
  fireEvent.click(open);
  await waitFor(() => expect(p.open).toHaveBeenCalledWith("new"));
});
it("selects the exact instance and deleting the last entry returns to zero", async () => {
  const item: StewardInstance = {
    id: "main",
    name: "Default",
    responsibilities: "Tasks",
    background: "Background",
    context: "Pending",
    sessionIds: ["old"],
    state: { version: 1, tasks: [] },
  };
  const p = props([item]);
  render(<StewardDirectory {...p} />);
  await screen.findByRole("heading", { name: "Default" });
  expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit Default" }));
  expect(screen.getByLabelText("Working context")).toHaveValue("Pending");
  fireEvent.click(
    screen.getByRole("button", { name: "Delete steward, keep conversations" }),
  );
  await screen.findByText(
    "No stewards yet. Create one or start an ordinary conversation.",
  );
  expect(p.remove).toHaveBeenCalledWith("main");
  expect(p.save).not.toHaveBeenCalled();
});
it("surfaces failed writes and keeps the entered profile for retry", async () => {
  const p = props();
  p.save = vi.fn().mockRejectedValue(new Error("disk full"));
  render(<StewardDirectory {...p} />);
  await screen.findByText(
    "No stewards yet. Create one or start an ordinary conversation.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Create steward" }));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New" } });
  fireEvent.change(screen.getByLabelText("Responsibilities"), {
    target: { value: "Tasks" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create steward" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
  expect(screen.getByLabelText("Name")).toHaveValue("New");
  expect(
    screen.getByRole("button", { name: "Create steward" }),
  ).not.toBeDisabled();
});

it("shows every configured steward immediately and opens the exact row", async () => {
  document.documentElement.lang = "en";
  const items = ["A", "B"].map((id) => ({
    id,
    name: `Steward ${id}`,
    responsibilities: `Duties ${id}`,
    background: "",
    context: "",
    sessionIds: [],
    state: { version: 1 as const, tasks: [] },
  }));
  const p = props(items);
  render(<StewardDirectory {...p} />);
  await screen.findByRole("heading", { name: "Steward A" });
  expect(
    screen.getByRole("heading", { name: "Steward B" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Duties B")).toBeInTheDocument();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open Steward B" }));
  await waitFor(() => expect(p.open).toHaveBeenCalledWith("B"));
});
it("returns from an unsaved creation to the list without saving", async () => {
  const p = props();
  render(<StewardDirectory {...p} />);
  await screen.findByText(
    "No stewards yet. Create one or start an ordinary conversation.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Create steward" }));
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Back to list" }));
  expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  expect(p.save).not.toHaveBeenCalled();
});
