import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { BasicsFields, connectWizardKit, defaultPresetId } from "../wizard-kit";

const presets = [
  { id: "full", label: "Full", isDefault: false },
  { id: "restricted", label: "Restricted", isDefault: true },
];

function Harness({
  list,
  prefillPreset,
}: {
  list: typeof presets;
  prefillPreset?: string;
}) {
  const [name, setName] = useState("");
  const [preset, setPreset] = useState(prefillPreset ?? "");
  return (
    <>
      <BasicsFields
        name={name}
        onNameChange={setName}
        preset={preset}
        onPresetChange={setPreset}
        presets={list}
      />
      <output data-testid="state">{JSON.stringify({ name, preset })}</output>
    </>
  );
}

describe("wizard kit", () => {
  it("defaultPresetId prefers prefill, then isDefault, then first", () => {
    expect(defaultPresetId(presets, "full")).toBe("full");
    expect(defaultPresetId(presets)).toBe("restricted");
    expect(defaultPresetId([{ id: "a", label: "A", isDefault: false }])).toBe(
      "a",
    );
    expect(defaultPresetId([])).toBe("");
  });

  it("labels its inputs and reports name edits", () => {
    render(<Harness list={presets} />);
    fireEvent.change(screen.getByLabelText(/连接名称|Connect name/), {
      target: { value: "飞书助手" },
    });
    expect(screen.getByTestId("state")).toHaveTextContent('"name":"飞书助手"');
  });

  it("selects the default preset once presets arrive, without overriding a chosen one", () => {
    const { rerender } = render(<Harness list={[]} />);
    expect(screen.getByTestId("state")).toHaveTextContent('"preset":""');
    rerender(<Harness list={presets} />);
    expect(screen.getByTestId("state")).toHaveTextContent(
      '"preset":"restricted"',
    );
    render(<Harness list={presets} prefillPreset="full" />);
    expect(screen.getAllByTestId("state")[1]).toHaveTextContent(
      '"preset":"full"',
    );
  });

  // A prefill is a SUGGESTION from the chat tool, not a promise: preset ids go
  // stale (renamed, deleted, another machine's list). An id the list doesn't
  // carry would otherwise sit there looking chosen — the Select shows its
  // placeholder while the wizard's own gate reads "ready" — and the create
  // would come back `agent_preset_required`.
  it("replaces a prefilled preset that is not in the list", () => {
    render(<Harness list={presets} prefillPreset="ghost" />);
    expect(screen.getByTestId("state")).toHaveTextContent(
      '"preset":"restricted"',
    );
  });

  it("keeps a prefilled preset the list does carry", () => {
    render(<Harness list={presets} prefillPreset="full" />);
    expect(screen.getByTestId("state")).toHaveTextContent('"preset":"full"');
  });

  it("exposes BasicsFields on the kit", () => {
    expect(connectWizardKit.BasicsFields).toBe(BasicsFields);
    expect(vi.isMockFunction(connectWizardKit.BasicsFields)).toBe(false);
  });
});
