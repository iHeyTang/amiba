import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
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
