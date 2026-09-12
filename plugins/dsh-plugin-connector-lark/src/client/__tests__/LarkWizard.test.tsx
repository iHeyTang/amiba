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

function hostWith(
  overrides: Partial<ConnectWizardHost> = {},
): ConnectWizardHost {
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
      ApprovalField: () => null,
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

const closeButton = () => screen.getByRole("button", { name: /关闭|Close/ });

const beginButton = () =>
  screen.getByRole("button", { name: /开始扫码|scanning/i });
const manualButton = () =>
  screen.getByRole("button", { name: /高级设置|Advanced:/ });
const returnToScanButton = () =>
  screen.getByRole("button", { name: /返回扫码|Back to scanning/ });

afterEach(() => vi.useRealTimers());

describe("LarkWizard", () => {
  it("opens directly in scan mode with manual setup as a fallback", () => {
    render(<LarkWizard host={hostWith({ back: undefined })} />);
    expect(
      screen.getByRole("heading", { name: /接入飞书|Connect Feishu/ }),
    ).toBeInTheDocument();
    expect(beginButton()).toBeInTheDocument();
    expect(manualButton()).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("App ID")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /返回连接器|Back to connectors/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /取消|Cancel/ }),
    ).not.toBeInTheDocument();
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
        pollOnboarding: vi.fn(async () => ({
          sessionId: "s1",
          state: "pending",
        })),
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
    });
  });

  it("inherits the shared approval policy when beginning onboarding", async () => {
    const begin = vi.fn(async () => ({ sessionId: "s1", state: "pending" }));
    const host = hostWith({
      adapter: {
        create: vi.fn(),
        beginOnboarding: begin,
        pollOnboarding: vi.fn(async () => ({
          sessionId: "s1",
          state: "pending",
        })),
        cancelOnboarding: vi.fn(async () => ({})),
      } as never,
    });
    render(<LarkWizard host={host} />);
    typeName();
    await act(async () => {
      fireEvent.click(beginButton());
    });

    expect(begin).toHaveBeenCalledWith(
      expect.not.objectContaining({ approval: expect.anything() }),
    );
  });

  it("returns to the connector directory and closes through the host", async () => {
    const host = hostWith();
    render(<LarkWizard host={host} />);
    await userEvent.click(
      screen.getByRole("button", { name: /返回连接器|Back to connectors/ }),
    );
    expect(host.back).toHaveBeenCalledTimes(1);

    await userEvent.click(closeButton());
    expect(host.cancel).toHaveBeenCalledTimes(1);
  });

  it("submits the manual form with appId/appSecret/domain and calls done", async () => {
    const host = hostWith();
    render(<LarkWizard host={host} />);
    await userEvent.click(manualButton());
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
    });
    expect(host.done).toHaveBeenCalledWith({ id: "c1" });
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
    await userEvent.click(manualButton());
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
        /创建连接前请先选择智能体预设。|Choose an agent preset before creating this connect\./,
      ),
    ).toBeInTheDocument();
    // The point of the mapping: the wire code never reaches the user.
    expect(screen.queryByText("agent_preset_required")).not.toBeInTheDocument();
    expect(host.done).not.toHaveBeenCalled();
  });

  it("secret field is a password input", async () => {
    render(<LarkWizard host={hostWith()} />);
    await userEvent.click(manualButton());
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
      fireEvent.click(manualButton());
    });

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith("s1");
    expect(screen.queryByAltText(/二维码|QR/)).not.toBeInTheDocument();
    screen.getByLabelText("App ID");
    poll.mockClear();
    await flush(3000);
    expect(poll).not.toHaveBeenCalled();
  });

  it("returns from manual setup with the account fields intact and a fresh scan entry", async () => {
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
      fireEvent.click(manualButton());
    });

    expect(cancel).toHaveBeenCalledWith("s1");
    await act(async () => {
      fireEvent.click(returnToScanButton());
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByAltText(/二维码|QR/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("连接名称")).toHaveValue("Sales");
    expect(beginButton()).toBeEnabled();
    expect(host.adapter.beginOnboarding).toHaveBeenCalledTimes(1);
    poll.mockClear();
    await flush(3000);
    expect(poll).not.toHaveBeenCalled();
  });

  it("can restart scanning after leaving a slow request and ignores its stale failure", async () => {
    let rejectOld!: (error: Error) => void;
    const begin = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectOld = reject;
          }),
      )
      .mockResolvedValueOnce({
        sessionId: "s2",
        state: "pending",
        qrUrl: "https://example.invalid/qr",
      });
    const host = hostWith();
    host.adapter.beginOnboarding = begin;
    render(<LarkWizard host={host} />);
    typeName();
    await userEvent.click(beginButton());
    expect(beginButton()).toBeDisabled();
    await userEvent.click(manualButton());
    await userEvent.click(returnToScanButton());
    expect(beginButton()).toBeEnabled();
    await userEvent.click(beginButton());
    expect(screen.getByAltText(/二维码|QR/)).toBeInTheDocument();
    await act(async () => rejectOld(new Error("stale scan error")));
    expect(screen.queryByText("stale scan error")).not.toBeInTheDocument();
    expect(screen.getByAltText(/二维码|QR/)).toBeInTheDocument();
    expect(begin).toHaveBeenCalledTimes(2);
  });

  // The retired per-provider dialog gated creation on a connect name AND a
  // non-empty agent preset; the standalone screen inherits that gate on its own
  // fields, so neither a nameless connect nor a preset list that hasn't loaded
  // yet can push a create the center would reject with `agent_preset_required`.
  it("blocks both entry points until the basics are filled", async () => {
    // Nameless: the preset filled itself in, both entry points stay shut.
    const host = hostWith();
    const { unmount } = render(<LarkWizard host={host} />);
    typeName("");
    expect(beginButton()).toBeDisabled();

    await userEvent.click(manualButton());
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
    await userEvent.click(closeButton());
    expect(host.cancel).toHaveBeenCalledTimes(1);
  });
});
