import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { PluginConfigCard } from "../PluginConfigCard";
vi.mock("@amiba/i18n/plugin", () => ({
  usePluginT: () => ({ language: "en" }),
}));
const ready = {
  available: true,
  writable: true,
  dirty: false,
  invalid: false,
  saving: false,
  failed: false,
};
it("stages edits without saving and respects validation, write permission and saving state", async () => {
  const actions = {
    edit: vi.fn(),
    resetField: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
  };
  const fields = [
    {
      name: "limit",
      label: "Limit",
      text: "4",
      overridden: true,
      invalid: false,
    },
  ];
  const { rerender } = render(
    <PluginConfigCard
      title="Agent"
      state={ready}
      fields={fields}
      {...actions}
    />,
  );
  await userEvent.type(screen.getByLabelText("Limit"), "2");
  expect(actions.edit).toHaveBeenCalled();
  expect(actions.save).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  rerender(
    <PluginConfigCard
      title="Agent"
      state={{ ...ready, dirty: true }}
      fields={fields}
      {...actions}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(actions.save).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "Reset" }));
  expect(actions.resetField).toHaveBeenCalledWith("limit");
  for (const state of [
    { ...ready, dirty: true, invalid: true },
    { ...ready, dirty: true, writable: false },
    { ...ready, dirty: true, saving: true },
  ]) {
    rerender(
      <PluginConfigCard
        title="Agent"
        state={state}
        fields={fields}
        {...actions}
      />,
    );
    fireEvent.submit(screen.getByRole("form", { name: "Agent" }));
  }
  expect(actions.save).toHaveBeenCalledTimes(1);
});
it("renders a masked write-only key and preserves failed input until discard", async () => {
  const actions = {
    edit: vi.fn(),
    resetField: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
  };
  const fields = [
    {
      name: "apiKey",
      label: "API Key",
      text: "fixture",
      overridden: false,
      invalid: false,
      secret: true,
      hint: "Configured; leave blank to keep.",
    },
  ];
  const { rerender } = render(
    <PluginConfigCard
      title="Search"
      state={{ ...ready, dirty: true, failed: true }}
      fields={fields}
      {...actions}
    />,
  );
  expect(screen.getByLabelText("API Key")).toHaveAttribute("type", "password");
  expect(screen.getByLabelText("API Key")).toHaveValue("fixture");
  expect(screen.getByRole("alert")).toHaveTextContent("not saved");
  expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Discard" }));
  expect(actions.discard).toHaveBeenCalledTimes(1);
  rerender(
    <PluginConfigCard
      title="Search"
      state={{ ...ready, available: false }}
      fields={fields}
      {...actions}
    />,
  );
  expect(screen.queryByRole("form")).toBeNull();
});
