import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ConnectWizardHost } from "@amiba/dsh-plugin-connector-core/client";

import { DingtalkWizard } from "../DingtalkWizard";

function host(overrides: Partial<ConnectWizardHost> = {}): ConnectWizardHost {
  return {
    providerId: "dingtalk",
    connectName: "Bot",
    agentPreset: "restricted",
    adapter: {
      create: vi.fn(async () => ({ id: "c1" }) as never),
      beginOnboarding: vi.fn(),
      pollOnboarding: vi.fn(),
      cancelOnboarding: vi.fn(),
    } as never,
    done: vi.fn(),
    cancel: vi.fn(),
    ...overrides,
  };
}

describe("DingtalkWizard", () => {
  it("creates with trimmed ids and enableTools:false by default", async () => {
    const h = host();
    render(<DingtalkWizard host={h} />);
    fireEvent.change(screen.getByLabelText("Client ID"), {
      target: { value: " cid " },
    });
    fireEvent.change(screen.getByLabelText(/Client [Ss]ecret/), {
      target: { value: " sec " },
    });
    await userEvent.click(screen.getByRole("button", { name: /添加|Add/ }));
    expect(h.adapter.create).toHaveBeenCalledWith({
      provider: "dingtalk",
      name: "Bot",
      agentPreset: "restricted",
      config: { clientId: "cid", clientSecret: "sec", enableTools: false },
    });
    expect(h.done).toHaveBeenCalledWith({ id: "c1" });
  });

  it("includes enableTools:true once the switch is on", async () => {
    const h = host();
    render(<DingtalkWizard host={h} />);
    fireEvent.change(screen.getByLabelText("Client ID"), {
      target: { value: "cid" },
    });
    fireEvent.change(screen.getByLabelText(/Client [Ss]ecret/), {
      target: { value: "sec" },
    });
    await userEvent.click(screen.getByRole("switch"));
    await userEvent.click(screen.getByRole("button", { name: /添加|Add/ }));
    expect(h.adapter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ enableTools: true }),
      }),
    );
  });

  it("blocks submit until both ids are present", () => {
    render(<DingtalkWizard host={host()} />);
    expect(screen.getByRole("button", { name: /添加|Add/ })).toBeDisabled();
  });

  it("translates a create failure code instead of rendering the raw code", async () => {
    const h = host({
      adapter: {
        create: vi.fn(async () => {
          throw new Error("agent_preset_required");
        }),
        beginOnboarding: vi.fn(),
        pollOnboarding: vi.fn(),
        cancelOnboarding: vi.fn(),
      } as never,
    });
    render(<DingtalkWizard host={h} />);
    fireEvent.change(screen.getByLabelText("Client ID"), {
      target: { value: "cid" },
    });
    fireEvent.change(screen.getByLabelText(/Client [Ss]ecret/), {
      target: { value: "sec" },
    });
    await userEvent.click(screen.getByRole("button", { name: /添加|Add/ }));

    expect(screen.getByText(/[Aa]gent [Pp]reset/)).toBeInTheDocument();
    expect(
      screen.queryByText("agent_preset_required"),
    ).not.toBeInTheDocument();
    expect(h.done).not.toHaveBeenCalled();
  });
});
