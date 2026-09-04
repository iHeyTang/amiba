import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectWizardHost } from "@amiba/dsh-plugin-connector-core/client";

import { LarkWizard } from "../LarkWizard";

/**
 * Stand-in for the real `host.kit.BasicsFields` (connector-core owns that
 * component and its own tests): plain labelled controls so this suite can drive
 * the wizard's own name/preset state, plus the same "fill an empty selection
 * once the presets land" behaviour the real one has.
 */
function FakeBasicsFields({
  name,
  onNameChange,
  preset,
  onPresetChange,
  presets,
}: {
  name: string;
  onNameChange(v: string): void;
  preset: string;
  onPresetChange(v: string): void;
  presets: { id: string; label: string; isDefault: boolean }[];
}) {
  useEffect(() => {
    // Same rule as the real kit: fill an empty selection AND replace one the
    // list doesn't carry (a stale prefill), once the presets have landed.
    if (presets.length === 0) return;
    if (preset && presets.some((p) => p.id === preset)) return;
    onPresetChange(presets.find((p) => p.isDefault)?.id ?? presets[0]!.id);
  }, [preset, presets, onPresetChange]);
  return (
    <div>
      <label>
        连接名称
        <input onChange={(e) => onNameChange(e.target.value)} value={name} />
      </label>
      <label>
        Agent 预设
        <select onChange={(e) => onPresetChange(e.target.value)} value={preset}>
          <option value="">-</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

const presets = [{ id: "restricted", label: "Restricted", isDefault: true }];

/**
 * Stand-in for `host.kit.ApprovalField` (connector-core owns the real one
 * and its own tests): a single radio pair plus a minutes input, enough to
 * drive and assert the wizard's own `approval` state without depending on
 * connector-core's actual component.
 */
function FakeApprovalField({
  approval,
  onApprovalChange,
}: {
  approval: { mode: "timeout" | "wait"; timeoutMs: number };
  onApprovalChange(value: { mode: "timeout" | "wait"; timeoutMs: number }): void;
}) {
  return (
    <div>
      <label>
        超时拒绝
        <input
          checked={approval.mode === "timeout"}
          onChange={() => onApprovalChange({ mode: "timeout", timeoutMs: approval.timeoutMs })}
          type="radio"
        />
      </label>
      <label>
        一直等
        <input
          checked={approval.mode === "wait"}
          onChange={() => onApprovalChange({ mode: "wait", timeoutMs: approval.timeoutMs })}
          type="radio"
        />
      </label>
      <label>
        等待分钟数
        <input
          onChange={(e) =>
            onApprovalChange({
              mode: "timeout",
              timeoutMs: Number(e.target.value) * 60_000,
            })
          }
          type="number"
          value={Math.round(approval.timeoutMs / 60_000)}
        />
      </label>
    </div>
  );
}

function hostWith(overrides: Partial<ConnectWizardHost> = {}): ConnectWizardHost {
  return {
    providerId: "lark",
    presets,
    adapter: {
      create: vi.fn(async () => ({ id: "c1" }) as never),
      beginOnboarding: vi.fn(),
      pollOnboarding: vi.fn(),
      cancelOnboarding: vi.fn(async () => ({}) as never),
    } as never,
    kit: {
      BasicsFields: FakeBasicsFields as never,
      ApprovalField: FakeApprovalField as never,
      // The wizard seeds its own approval state from the kit rather than
      // carrying a copy of connector-core's literal.
      defaultApproval: () => ({ mode: "timeout", timeoutMs: 600_000 }),
    },
    back: vi.fn(),
    done: vi.fn(),
    cancel: vi.fn(),
    ...overrides,
  } as ConnectWizardHost;
}

/**
 * Under `vi.useFakeTimers()` RTL's `findBy*` waits on REAL timers and never
 * settles, so every scan assertion below advances the fake clock inside `act`
 * and then reads synchronously with `getBy*`.
 */
async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * Both entry points are gated on the wizard's OWN basics now, so every test
 * that wants to reach `beginOnboarding`/`create` types a name first; the preset
 * fills itself in from `host.presets`.
 */
function typeName(value = "Sales") {
  fireEvent.change(screen.getByLabelText("连接名称"), { target: { value } });
}

/** The header's icon-only close (aria-labelled) vs the footer's own cancel button. */
function cancelControls() {
  const all = screen.getAllByRole("button", { name: /取消|Cancel/ });
  return {
    headerClose: all.filter((b) => !b.textContent?.trim())[0] as HTMLElement,
    footerCancel: all.filter((b) => Boolean(b.textContent?.trim()))[0] as HTMLElement,
  };
}

const beginButton = () =>
  screen.getByRole("button", { name: /开始扫码|scanning/i });
const manualTab = () => screen.getByRole("tab", { name: /手动填写|Manual/ });
const scanTab = () => screen.getByRole("tab", { name: /扫码接入|Scan to connect/ });

afterEach(() => vi.useRealTimers());

describe("LarkWizard", () => {
  it("renders its own header and tabs", () => {
    render(<LarkWizard host={hostWith()} />);
    expect(
      screen.getByRole("heading", { name: /接入飞书|Connect Feishu/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /扫码接入|Scan to connect/ }),
    ).toHaveAttribute("aria-selected", "true");
    expect(manualTab()).toHaveAttribute("aria-selected", "false");
  });

  it("seeds the name from the host prefill", () => {
    render(<LarkWizard host={hostWith({ prefill: { name: "飞书助手" } })} />);
    expect(screen.getByLabelText("连接名称")).toHaveValue("飞书助手");
  });

  it("drops a prefilled preset the host's list doesn't carry", async () => {
    const begin = vi.fn(async () => ({ sessionId: "s1", state: "pending" }));
    const host = hostWith({
      prefill: { agentPreset: "ghost" },
      adapter: {
        create: vi.fn(),
        beginOnboarding: begin,
        pollOnboarding: vi.fn(async () => ({ sessionId: "s1", state: "pending" })),
        cancelOnboarding: vi.fn(async () => ({})),
      } as never,
    });
    render(<LarkWizard host={host} />);
    typeName();
    await act(async () => {
      fireEvent.click(beginButton());
    });
    // Never the stale suggestion: the kit healed the selection to the default.
    expect(begin).toHaveBeenCalledWith({
      provider: "lark",
      name: "Sales",
      agentPreset: "restricted",
      approval: { mode: "timeout", timeoutMs: 10 * 60_000 },
    });
  });

  it("carries the scan tab's approval choice into beginOnboarding", async () => {
    const begin = vi.fn(async () => ({ sessionId: "s1", state: "pending" }));
    const host = hostWith({
      adapter: {
        create: vi.fn(),
        beginOnboarding: begin,
        pollOnboarding: vi.fn(async () => ({ sessionId: "s1", state: "pending" })),
        cancelOnboarding: vi.fn(async () => ({})),
      } as never,
    });
    render(<LarkWizard host={host} />);
    typeName();
    // The scan path has no later `adapter.create` call to carry the choice,
    // so it has to ride along with the onboarding request itself.
    await userEvent.click(screen.getByText("一直等"));
    await act(async () => {
      fireEvent.click(beginButton());
    });

    expect(begin).toHaveBeenCalledWith(
      expect.objectContaining({
        approval: { mode: "wait", timeoutMs: 10 * 60_000 },
      }),
    );
  });

  it("goes back to the platform picker and closes through the host", async () => {
    const host = hostWith();
    render(<LarkWizard host={host} />);
    await userEvent.click(
      screen.getByRole("button", { name: /换个平台|Change platform/ }),
    );
    expect(host.back).toHaveBeenCalledTimes(1);

    await userEvent.click(cancelControls().headerClose);
    expect(host.cancel).toHaveBeenCalledTimes(1);
  });

  it("submits the manual form with appId/appSecret/domain and calls done", async () => {
    const host = hostWith();
    render(<LarkWizard host={host} />);
    await userEvent.click(manualTab());
    typeName();
    fireEvent.change(screen.getByLabelText("App ID"), {
      target: { value: "cli_x" },
    });
    fireEvent.change(screen.getByLabelText(/App [Ss]ecret/), {
      target: { value: " secret " },
    });
    await userEvent.click(screen.getByRole("button", { name: /添加|Add/ }));
    expect(host.adapter.create).toHaveBeenCalledWith({
      provider: "lark",
      name: "Sales",
      agentPreset: "restricted",
      config: { appId: "cli_x", appSecret: "secret", domain: "feishu" },
      approval: { mode: "timeout", timeoutMs: 10 * 60_000 },
    });
    expect(host.done).toHaveBeenCalledWith({ id: "c1" });
  });

  it("renders the approval field in both the scan and manual tabs", async () => {
    render(<LarkWizard host={hostWith()} />);
    expect(screen.getByText("超时拒绝")).toBeInTheDocument();

    await userEvent.click(manualTab());
    expect(screen.getByText("超时拒绝")).toBeInTheDocument();
  });

  it("submits the manual form with the approval value the user picked", async () => {
    const host = hostWith();
    render(<LarkWizard host={host} />);
    await userEvent.click(manualTab());
    typeName();
    fireEvent.change(screen.getByLabelText("App ID"), {
      target: { value: "cli_x" },
    });
    fireEvent.change(screen.getByLabelText(/App [Ss]ecret/), {
      target: { value: "secret" },
    });
    await userEvent.click(screen.getByText("一直等"));
    await userEvent.click(screen.getByRole("button", { name: /添加|Add/ }));

    expect(host.adapter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        approval: { mode: "wait", timeoutMs: 10 * 60_000 },
      }),
    );
  });

  it("translates a create failure code instead of rendering the raw code", async () => {
    const host = hostWith({
      adapter: {
        create: vi.fn(async () => {
          throw new Error("agent_preset_required");
        }),
        beginOnboarding: vi.fn(),
        pollOnboarding: vi.fn(),
        cancelOnboarding: vi.fn(async () => ({})),
      } as never,
    });
    render(<LarkWizard host={host} />);
    await userEvent.click(manualTab());
    typeName();
    fireEvent.change(screen.getByLabelText("App ID"), {
      target: { value: "cli_x" },
    });
    fireEvent.change(screen.getByLabelText(/App [Ss]ecret/), {
      target: { value: "secret" },
    });
    await userEvent.click(screen.getByRole("button", { name: /添加|Add/ }));

    expect(
      screen.getByText(
        /创建连接前请先选择 Agent Preset。|Choose an agent preset before creating this connect\./,
      ),
    ).toBeInTheDocument();
    // The point of the mapping: the wire code never reaches the user.
    expect(screen.getByText(/[Aa]gent [Pp]reset/)).toBeInTheDocument();
    expect(screen.queryByText("agent_preset_required")).not.toBeInTheDocument();
    expect(host.done).not.toHaveBeenCalled();
  });

  it("secret field is a password input", async () => {
    render(<LarkWizard host={hostWith()} />);
    await userEvent.click(manualTab());
    expect(screen.getByLabelText(/App [Ss]ecret/)).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("scan mode begins onboarding and renders the QR once a poll returns a qrUrl", async () => {
    vi.useFakeTimers();
    const begin = vi.fn(async () => ({ sessionId: "s1", state: "pending" }));
    const poll = vi.fn(async () => ({
      sessionId: "s1",
      state: "pending",
      qrUrl: "https://x/qr",
    }));
    const host = hostWith({
      adapter: {
        create: vi.fn(),
        beginOnboarding: begin,
        pollOnboarding: poll,
        cancelOnboarding: vi.fn(async () => ({})),
      } as never,
    });
    render(<LarkWizard host={host} />);
    typeName();
    await act(async () => {
      fireEvent.click(beginButton());
    });
    expect(begin).toHaveBeenCalledWith({
      provider: "lark",
      name: "Sales",
      agentPreset: "restricted",
      approval: { mode: "timeout", timeoutMs: 10 * 60_000 },
    });
    await flush(1600);
    expect(poll).toHaveBeenCalledWith("s1");
    expect(screen.getByAltText(/二维码|QR/)).toBeInTheDocument();
  });

  it("completes: a poll returning completed calls done with the connect", async () => {
    vi.useFakeTimers();
    const connect = { id: "c9" };
    const poll = vi.fn(async () => ({
      sessionId: "s1",
      state: "completed",
      connect,
    }));
    const host = hostWith({
      adapter: {
        create: vi.fn(),
        beginOnboarding: vi.fn(async () => ({
          sessionId: "s1",
          state: "pending",
        })),
        pollOnboarding: poll,
        cancelOnboarding: vi.fn(async () => ({})),
      } as never,
    });
    render(<LarkWizard host={host} />);
    typeName();
    await act(async () => {
      fireEvent.click(beginButton());
    });
    await flush(1600);
    expect(host.done).toHaveBeenCalledWith(connect);
  });

  it("shows a translated error and no QR when a poll returns error", async () => {
    vi.useFakeTimers();
    const host = hostWith({
      adapter: {
        create: vi.fn(),
        beginOnboarding: vi.fn(async () => ({
          sessionId: "s1",
          state: "pending",
        })),
        pollOnboarding: vi.fn(async () => ({
          sessionId: "s1",
          state: "error",
          error: "onboarding_unsupported",
        })),
        cancelOnboarding: vi.fn(async () => ({})),
      } as never,
    });
    render(<LarkWizard host={host} />);
    typeName();
    await act(async () => {
      fireEvent.click(beginButton());
    });
    await flush(1600);
    expect(
      screen.getByText(
        /该 Provider 不支持扫码接入。|That provider doesn't support scan-to-connect onboarding\./,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByAltText(/二维码|QR/)).not.toBeInTheDocument();
    // Terminal error is never a dead end: the begin control comes back.
    expect(beginButton()).toBeEnabled();
    expect(host.done).not.toHaveBeenCalled();
  });

  it("cancels the pending session and stops polling when unmounted mid-scan", async () => {
    vi.useFakeTimers();
    const poll = vi.fn(async () => ({
      sessionId: "s1",
      state: "pending",
      qrUrl: "https://x/qr",
    }));
    const cancel = vi.fn(async () => ({ sessionId: "s1", state: "cancelled" }));
    const host = hostWith({
      adapter: {
        create: vi.fn(),
        beginOnboarding: vi.fn(async () => ({
          sessionId: "s1",
          state: "pending",
        })),
        pollOnboarding: poll,
        cancelOnboarding: cancel,
      } as never,
    });
    const { unmount } = render(<LarkWizard host={host} />);
    typeName();
    await act(async () => {
      fireEvent.click(beginButton());
    });
    await flush(1600);
    screen.getByAltText(/二维码|QR/);

    unmount();
    await flush();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith("s1");
    poll.mockClear();
    await flush(3000);
    expect(poll).not.toHaveBeenCalled();
  });

  it("cancels the pending session and stops polling when switching scan → manual", async () => {
    vi.useFakeTimers();
    const poll = vi.fn(async () => ({
      sessionId: "s1",
      state: "pending",
      qrUrl: "https://x/qr",
    }));
    const cancel = vi.fn(async () => ({ sessionId: "s1", state: "cancelled" }));
    const host = hostWith({
      adapter: {
        create: vi.fn(),
        beginOnboarding: vi.fn(async () => ({
          sessionId: "s1",
          state: "pending",
        })),
        pollOnboarding: poll,
        cancelOnboarding: cancel,
      } as never,
    });
    render(<LarkWizard host={host} />);
    typeName();
    await act(async () => {
      fireEvent.click(beginButton());
    });
    await flush(1600);
    screen.getByAltText(/二维码|QR/);

    await act(async () => {
      fireEvent.click(manualTab());
    });

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith("s1");
    expect(screen.queryByAltText(/二维码|QR/)).not.toBeInTheDocument();
    screen.getByLabelText("App ID");
    poll.mockClear();
    await flush(3000);
    expect(poll).not.toHaveBeenCalled();
  });

  // Re-selecting the tab you are already on is not a mode CHANGE, so it must
  // not tear down a live scan: the QR the user is looking at stays on screen.
  it("re-selecting the active scan tab leaves the live session alone", async () => {
    vi.useFakeTimers();
    const poll = vi.fn(async () => ({
      sessionId: "s1",
      state: "pending",
      qrUrl: "https://x/qr",
    }));
    const cancel = vi.fn(async () => ({ sessionId: "s1", state: "cancelled" }));
    const host = hostWith({
      adapter: {
        create: vi.fn(),
        beginOnboarding: vi.fn(async () => ({
          sessionId: "s1",
          state: "pending",
        })),
        pollOnboarding: poll,
        cancelOnboarding: cancel,
      } as never,
    });
    render(<LarkWizard host={host} />);
    typeName();
    await act(async () => {
      fireEvent.click(beginButton());
    });
    await flush(1600);
    screen.getByAltText(/二维码|QR/);

    await act(async () => {
      fireEvent.click(scanTab());
    });

    expect(cancel).not.toHaveBeenCalled();
    expect(screen.getByAltText(/二维码|QR/)).toBeInTheDocument();

    // A real change still cancels exactly once (the existing behaviour).
    await act(async () => {
      fireEvent.click(manualTab());
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith("s1");
  });

  // The retired per-provider dialog gated creation on a connect name AND a
  // non-empty agent preset; the standalone screen inherits that gate on its own
  // fields, so neither a nameless connect nor a preset list that hasn't loaded
  // yet can push a create the center would reject with `agent_preset_required`.
  it("blocks both entry points until the basics are filled", async () => {
    // Nameless: the preset filled itself in, both entry points stay shut.
    const host = hostWith();
    const { unmount } = render(<LarkWizard host={host} />);
    expect(beginButton()).toBeDisabled();

    await userEvent.click(manualTab());
    fireEvent.change(screen.getByLabelText("App ID"), {
      target: { value: "cli_x" },
    });
    fireEvent.change(screen.getByLabelText(/App [Ss]ecret/), {
      target: { value: "secret" },
    });
    expect(screen.getByRole("button", { name: /添加|Add/ })).toBeDisabled();
    expect(host.adapter.beginOnboarding).not.toHaveBeenCalled();
    expect(host.adapter.create).not.toHaveBeenCalled();
    unmount();

    // Named, but no preset can be chosen yet: still shut.
    const presetless = hostWith({ presets: [] });
    render(<LarkWizard host={presetless} />);
    typeName();
    expect(beginButton()).toBeDisabled();
    expect(presetless.adapter.beginOnboarding).not.toHaveBeenCalled();
  });

  it("cancels the wizard through the host", async () => {
    const host = hostWith();
    render(<LarkWizard host={host} />);
    await userEvent.click(cancelControls().footerCancel);
    expect(host.cancel).toHaveBeenCalledTimes(1);
  });
});
