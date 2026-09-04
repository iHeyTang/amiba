import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  ApprovalField, BasicsFields, connectWizardKit, defaultApproval, defaultPresetId,
} from "../wizard-kit";
import type { MessageChannelApproval } from "../../types";

const presets = [
  { id: "full", label: "Full", isDefault: false },
  { id: "restricted", label: "Restricted", isDefault: true },
];

function Harness({ list, prefillPreset }: { list: typeof presets; prefillPreset?: string }) {
  const [name, setName] = useState("");
  const [preset, setPreset] = useState(prefillPreset ?? "");
  return (
    <>
      <BasicsFields name={name} onNameChange={setName} preset={preset} onPresetChange={setPreset} presets={list} />
      <output data-testid="state">{JSON.stringify({ name, preset })}</output>
    </>
  );
}

describe("wizard kit", () => {
  it("defaultPresetId prefers prefill, then isDefault, then first", () => {
    expect(defaultPresetId(presets, "full")).toBe("full");
    expect(defaultPresetId(presets)).toBe("restricted");
    expect(defaultPresetId([{ id: "a", label: "A", isDefault: false }])).toBe("a");
    expect(defaultPresetId([])).toBe("");
  });

  it("labels its inputs and reports name edits", () => {
    render(<Harness list={presets} />);
    fireEvent.change(screen.getByLabelText(/连接名称|Connect name/), { target: { value: "飞书助手" } });
    expect(screen.getByTestId("state")).toHaveTextContent('"name":"飞书助手"');
  });

  it("selects the default preset once presets arrive, without overriding a chosen one", () => {
    const { rerender } = render(<Harness list={[]} />);
    expect(screen.getByTestId("state")).toHaveTextContent('"preset":""');
    rerender(<Harness list={presets} />);
    expect(screen.getByTestId("state")).toHaveTextContent('"preset":"restricted"');
    render(<Harness list={presets} prefillPreset="full" />);
    expect(screen.getAllByTestId("state")[1]).toHaveTextContent('"preset":"full"');
  });

  // A prefill is a SUGGESTION from the chat tool, not a promise: preset ids go
  // stale (renamed, deleted, another machine's list). An id the list doesn't
  // carry would otherwise sit there looking chosen — the Select shows its
  // placeholder while the wizard's own gate reads "ready" — and the create
  // would come back `agent_preset_required`.
  it("replaces a prefilled preset that is not in the list", () => {
    render(<Harness list={presets} prefillPreset="ghost" />);
    expect(screen.getByTestId("state")).toHaveTextContent('"preset":"restricted"');
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

function ApprovalHarness({ initial }: { initial?: MessageChannelApproval }) {
  const [approval, setApproval] = useState<MessageChannelApproval>(
    initial ?? defaultApproval(),
  );
  return (
    <>
      <ApprovalField approval={approval} onApprovalChange={setApproval} />
      <output data-testid="approval-state">{JSON.stringify(approval)}</output>
    </>
  );
}

describe("ApprovalField", () => {
  it("defaultApproval is a 10-minute timeout", () => {
    expect(defaultApproval()).toEqual({ mode: "timeout", timeoutMs: 600_000 });
  });

  it("renders the default timeout mode with a 10-minute value and the wait option unchecked", () => {
    render(<ApprovalHarness />);
    const timeoutRadio = screen.getByRole("radio", { name: /超时拒绝|Reject after/ });
    const waitRadio = screen.getByRole("radio", { name: /一直等|Wait indefinitely/ });
    expect(timeoutRadio).toBeChecked();
    expect(waitRadio).not.toBeChecked();
    expect(screen.getByLabelText(/超时拒绝前等待的分钟数|Minutes before rejecting/)).toHaveValue(10);
  });

  it("switching to wait keeps the previous minutes value and disables its input", () => {
    render(<ApprovalHarness />);
    fireEvent.click(screen.getByRole("radio", { name: /一直等|Wait indefinitely/ }));

    expect(screen.getByTestId("approval-state")).toHaveTextContent(
      '"mode":"wait"',
    );
    expect(screen.getByLabelText(/超时拒绝前等待的分钟数|Minutes before rejecting/)).toBeDisabled();
  });

  it("switching back to timeout from wait restores the timeoutMs the minutes field carried", () => {
    render(<ApprovalHarness initial={{ mode: "wait", timeoutMs: 300_000 }} />);
    fireEvent.click(screen.getByRole("radio", { name: /超时拒绝|Reject after/ }));

    expect(screen.getByTestId("approval-state")).toHaveTextContent(
      '{"mode":"timeout","timeoutMs":300000}',
    );
  });

  it("editing the minutes field emits an updated timeoutMs in milliseconds", () => {
    render(<ApprovalHarness />);
    fireEvent.change(
      screen.getByLabelText(/超时拒绝前等待的分钟数|Minutes before rejecting/),
      { target: { value: "30" } },
    );

    expect(screen.getByTestId("approval-state")).toHaveTextContent(
      '{"mode":"timeout","timeoutMs":1800000}',
    );
  });

  it("floors an invalid or sub-minimum minutes edit at 1 minute instead of emitting garbage", () => {
    render(<ApprovalHarness />);
    const minutesInput = screen.getByLabelText(/超时拒绝前等待的分钟数|Minutes before rejecting/);

    fireEvent.change(minutesInput, { target: { value: "0" } });
    expect(screen.getByTestId("approval-state")).toHaveTextContent(
      '{"mode":"timeout","timeoutMs":60000}',
    );

    fireEvent.change(minutesInput, { target: { value: "not-a-number" } });
    expect(screen.getByTestId("approval-state")).toHaveTextContent(
      '{"mode":"timeout","timeoutMs":60000}',
    );
  });

  it("exposes ApprovalField on the kit", () => {
    expect(connectWizardKit.ApprovalField).toBe(ApprovalField);
    expect(vi.isMockFunction(connectWizardKit.ApprovalField)).toBe(false);
  });
});
