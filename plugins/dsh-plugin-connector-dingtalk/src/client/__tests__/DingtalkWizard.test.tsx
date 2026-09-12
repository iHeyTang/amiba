import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectWizardHost } from "@amiba/dsh-plugin-connector-core/client";

import { DingtalkWizard } from "../DingtalkWizard";

/**
 * Stand-in for the real `host.kit.BasicsFields` (connector-core owns that
 * component and its own tests): plain labelled controls so this suite can
 * drive the wizard's own name/preset state, plus the same "fill an empty
 * selection once the presets land" behaviour the real one has.
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
    providerId: "dingtalk",
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
 * The wizard is gated on its own basics now, so every test that wants to
 * reach `create` types a name first; the preset fills itself in from
 * `host.presets`.
 */
function typeName(value = "Bot") {
  fireEvent.change(screen.getByLabelText("连接名称"), { target: { value } });
}

const closeButton = () => screen.getByRole("button", { name: /关闭|Close/ });

function fillIds({ clientId = "cid", clientSecret = "sec" } = {}) {
  const manual = screen.queryByRole("button", {
    name: /高级设置|Advanced:/,
  });
  if (manual) fireEvent.click(manual);
  fireEvent.change(screen.getByLabelText("Client ID"), {
    target: { value: clientId },
  });
  fireEvent.change(screen.getByLabelText(/Client [Ss]ecret/), {
    target: { value: clientSecret },
  });
}

const submitButton = () => screen.getByRole("button", { name: /添加|Add/ });

describe("DingtalkWizard", () => {
  it("renders its own standalone header", () => {
    render(<DingtalkWizard host={hostWith()} />);
    expect(
      screen.getByRole("heading", { name: /接入钉钉|Connect DingTalk/ }),
    ).toBeInTheDocument();
  });

  it("seeds the name from the host prefill", () => {
    render(
      <DingtalkWizard host={hostWith({ prefill: { name: "钉钉助手" } })} />,
    );
    expect(screen.getByLabelText("连接名称")).toHaveValue("钉钉助手");
  });

  it("drops a prefilled preset the host's list doesn't carry", async () => {
    const host = hostWith({ prefill: { agentPreset: "ghost" } });
    render(<DingtalkWizard host={host} />);
    typeName();
    fillIds({ clientId: "cid", clientSecret: "sec" });
    await userEvent.click(submitButton());
    // Never the stale suggestion: the kit healed the selection to the default.
    expect(host.adapter.create).toHaveBeenCalledWith(
      expect.objectContaining({ agentPreset: "restricted" }),
    );
  });

  it("returns to the connector directory and closes through the host", async () => {
    const host = hostWith();
    render(<DingtalkWizard host={host} />);
    await userEvent.click(
      screen.getByRole("button", { name: /返回连接器|Back to connectors/ }),
    );
    expect(host.back).toHaveBeenCalledTimes(1);

    await userEvent.click(closeButton());
    expect(host.cancel).toHaveBeenCalledTimes(1);
  });

  it("closes from settings without a redundant back or cancel action", async () => {
    const host = hostWith({ back: undefined });
    render(<DingtalkWizard host={host} />);
    expect(
      screen.queryByRole("button", { name: /返回连接器|Back to connectors/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /取消|Cancel/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(closeButton());
    expect(host.cancel).toHaveBeenCalledTimes(1);
  });

  it("creates with trimmed ids, tools disabled and the inherited approval policy", async () => {
    const host = hostWith();
    render(<DingtalkWizard host={host} />);
    typeName("Bot");
    fillIds();
    fireEvent.change(screen.getByLabelText("Client ID"), {
      target: { value: " cid " },
    });
    fireEvent.change(screen.getByLabelText(/Client [Ss]ecret/), {
      target: { value: " sec " },
    });
    await userEvent.click(submitButton());
    expect(host.adapter.create).toHaveBeenCalledWith({
      provider: "dingtalk",
      name: "Bot",
      agentPreset: "restricted",
      config: { clientId: "cid", clientSecret: "sec" },
    });
    expect(host.done).toHaveBeenCalledWith({ id: "c1" });
  });

  it("blocks submit until both ids are present", () => {
    const host = hostWith();
    render(<DingtalkWizard host={host} />);
    typeName("Bot");
    fillIds({ clientId: "", clientSecret: "" });
    expect(submitButton()).toBeDisabled();
    expect(host.adapter.create).not.toHaveBeenCalled();
  });

  // The retired per-provider dialog gated creation on a connect name AND a
  // non-empty agent preset; the standalone screen inherits that gate on its
  // own fields, so a preset list that hasn't loaded yet can't push a create
  // the center would reject with `agent_preset_required`.
  it("blocks submit until an agent preset is chosen", () => {
    const host = hostWith({ presets: [] });
    render(<DingtalkWizard host={host} />);
    typeName("Bot");
    fillIds();
    expect(submitButton()).toBeDisabled();
    expect(host.adapter.create).not.toHaveBeenCalled();
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
    render(<DingtalkWizard host={host} />);
    typeName("Bot");
    fillIds();
    await userEvent.click(submitButton());

    expect(
      screen.getByText(
        /创建连接前请先选择智能体预设。|Choose an agent preset before creating this connect\./,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("agent_preset_required")).not.toBeInTheDocument();
    expect(host.done).not.toHaveBeenCalled();
  });
});

describe("DingtalkWizard quick connection", () => {
  afterEach(() => vi.useRealTimers());
  const startButton = () =>
    screen.getByRole("button", { name: /开始快速连接|Start quick connection/ });
  const manualButton = () =>
    screen.getByRole("button", { name: /高级设置|Advanced:/ });
  function setupScan() {
    vi.useFakeTimers();
    const host = hostWith({ prefill: { name: "Bot" } });
    vi.mocked(host.adapter.beginOnboarding).mockResolvedValue({
      sessionId: "s1",
      state: "pending",
    });
    const view = render(<DingtalkWizard host={host} />);
    return { host, ...view };
  }
  async function start() {
    await act(async () => fireEvent.click(startButton()));
  }
  async function poll() {
    await act(async () => vi.advanceTimersByTimeAsync(1500));
  }
  it("defaults to quick connection and completes using the server-created connection", async () => {
    const { host } = setupScan();
    expect(screen.queryByLabelText("Client ID")).not.toBeInTheDocument();
    await start();
    expect(host.adapter.beginOnboarding).toHaveBeenCalledWith({
      provider: "dingtalk",
      name: "Bot",
      agentPreset: "restricted",
    });
    vi.mocked(host.adapter.pollOnboarding).mockResolvedValueOnce({
      sessionId: "s1",
      state: "pending",
      qrUrl: "https://open-dev.dingtalk.com/authorize",
      statusNote: "polling",
    });
    await poll();
    expect(
      screen.getByRole("img", { name: /钉钉授权|DingTalk authorization/ }),
    ).toBeInTheDocument();
    const connect = { id: "created" } as never;
    vi.mocked(host.adapter.pollOnboarding).mockResolvedValueOnce({
      sessionId: "s1",
      state: "completed",
      connect,
    });
    await poll();
    await poll();
    expect(host.done).toHaveBeenCalledTimes(1);
    expect(host.done).toHaveBeenCalledWith(connect);
    expect(host.adapter.create).not.toHaveBeenCalled();
  });
  it("cancels polling when switching to manual input", async () => {
    const { host } = setupScan();
    await start();
    await act(async () => fireEvent.click(manualButton()));
    await poll();
    expect(host.adapter.cancelOnboarding).toHaveBeenCalledWith("s1");
    expect(host.adapter.pollOnboarding).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Client ID")).toBeInTheDocument();
  });
  it("cancels a session returned after the wizard was closed", async () => {
    const { host, unmount } = setupScan();
    let resolve!: (v: never) => void;
    vi.mocked(host.adapter.beginOnboarding).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await start();
    unmount();
    await act(async () =>
      resolve({ sessionId: "late", state: "pending" } as never),
    );
    expect(host.adapter.cancelOnboarding).toHaveBeenCalledWith("late");
    expect(host.done).not.toHaveBeenCalled();
  });
  it("offers a fresh scan after expiration", async () => {
    const { host } = setupScan();
    await start();
    vi.mocked(host.adapter.pollOnboarding).mockResolvedValueOnce({
      sessionId: "s1",
      state: "error",
      error: "dingtalk_registration_expired",
    });
    await poll();
    expect(
      screen.getByText(/授权已过期|Authorization expired/),
    ).toBeInTheDocument();
    expect(startButton()).toBeEnabled();
    await start();
    expect(host.adapter.beginOnboarding).toHaveBeenCalledTimes(2);
  });
  it("cancels the server session and permits retry after a polling transport failure", async () => {
    const { host } = setupScan();
    await start();
    vi.mocked(host.adapter.pollOnboarding).mockRejectedValueOnce(
      new Error("network offline"),
    );
    await poll();
    expect(host.adapter.cancelOnboarding).toHaveBeenCalledWith("s1");
    expect(startButton()).toBeEnabled();
  });
  it("ignores a stale successful poll after switching to manual mode", async () => {
    const { host } = setupScan();
    await start();
    let resolve!: (v: never) => void;
    vi.mocked(host.adapter.pollOnboarding).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await poll();
    await act(async () => fireEvent.click(manualButton()));
    await act(async () =>
      resolve({
        sessionId: "s1",
        state: "completed",
        connect: { id: "stale" },
      } as never),
    );
    expect(host.done).not.toHaveBeenCalled();
  });
});
