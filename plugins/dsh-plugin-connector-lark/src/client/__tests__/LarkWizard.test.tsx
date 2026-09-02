import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectWizardHost } from "@amiba/dsh-plugin-connector-core/client";

import { LarkWizard } from "../LarkWizard";

function hostWith(overrides: Partial<ConnectWizardHost> = {}): ConnectWizardHost {
  return {
    providerId: "lark",
    connectName: "Sales",
    agentPreset: "restricted",
    adapter: {
      create: vi.fn(async () => ({ id: "c1" }) as never),
      beginOnboarding: vi.fn(),
      pollOnboarding: vi.fn(),
      cancelOnboarding: vi.fn(async () => ({}) as never),
    } as never,
    done: vi.fn(),
    cancel: vi.fn(),
    ...overrides,
  };
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

afterEach(() => vi.useRealTimers());

describe("LarkWizard", () => {
  it("submits the manual form with appId/appSecret/domain and calls done", async () => {
    const host = hostWith();
    render(<LarkWizard host={host} />);
    await userEvent.click(screen.getByText(/手动填写|Manual/));
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
    await userEvent.click(screen.getByText(/手动填写|Manual/));
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
    await userEvent.click(screen.getByText(/手动填写|Manual/));
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
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /开始扫码|scanning/i }),
      );
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
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /开始扫码|scanning/i }),
      );
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
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /开始扫码|scanning/i }),
      );
    });
    await flush(1600);
    expect(
      screen.getByText(
        /该 Provider 不支持扫码接入。|That provider doesn't support scan-to-connect onboarding\./,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByAltText(/二维码|QR/)).not.toBeInTheDocument();
    // Terminal error is never a dead end: the begin control comes back.
    expect(
      screen.getByRole("button", { name: /开始扫码|scanning/i }),
    ).toBeEnabled();
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
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /开始扫码|scanning/i }),
      );
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
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /开始扫码|scanning/i }),
      );
    });
    await flush(1600);
    screen.getByAltText(/二维码|QR/);

    await act(async () => {
      fireEvent.click(screen.getByText(/手动填写|Manual/));
    });

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith("s1");
    expect(screen.queryByAltText(/二维码|QR/)).not.toBeInTheDocument();
    screen.getByLabelText("App ID");
    poll.mockClear();
    await flush(3000);
    expect(poll).not.toHaveBeenCalled();
  });

  // The retired per-provider dialog gated creation on a non-empty agent
  // preset; the body inherits that gate, so a preset list that hasn't loaded
  // yet can't push a create the center would reject with
  // `agent_preset_required`.
  it("blocks both entry points until an agent preset is chosen", async () => {
    const host = hostWith({ agentPreset: "" });
    render(<LarkWizard host={host} />);
    expect(
      screen.getByRole("button", { name: /开始扫码|scanning/i }),
    ).toBeDisabled();

    await userEvent.click(screen.getByText(/手动填写|Manual/));
    fireEvent.change(screen.getByLabelText("App ID"), {
      target: { value: "cli_x" },
    });
    fireEvent.change(screen.getByLabelText(/App [Ss]ecret/), {
      target: { value: "secret" },
    });
    expect(screen.getByRole("button", { name: /添加|Add/ })).toBeDisabled();
    expect(host.adapter.beginOnboarding).not.toHaveBeenCalled();
    expect(host.adapter.create).not.toHaveBeenCalled();
  });

  it("cancels the wizard through the host", async () => {
    const host = hostWith();
    render(<LarkWizard host={host} />);
    await userEvent.click(screen.getByRole("button", { name: /取消|Cancel/ }));
    expect(host.cancel).toHaveBeenCalledTimes(1);
  });
});
