// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ConnectWizardHost } from "@amiba/dsh-plugin-connector-core/client";
import { WeixinWizard } from "./index.js";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function host() {
  return {
    providerId: "weixin",
    presets: [{ id: "standard", label: "默认助手", isDefault: true }],
    adapter: {
      beginOnboarding: vi.fn(),
      pollOnboarding: vi.fn(),
      cancelOnboarding: vi.fn(async () => ({})),
      submitOnboardingInput: vi.fn(async () => ({})),
    },
    kit: {
      BasicsFields: ({ name, onNameChange }: any) => (
        <label>
          连接名称
          <input
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
          />
        </label>
      ),
    },
    done: vi.fn(),
    cancel: vi.fn(),
  } as unknown as ConnectWizardHost;
}
it("shows a QR, waits for confirmation, then completes with the created connection", async () => {
  vi.useFakeTimers();
  const h = host();
  vi.mocked(h.adapter.beginOnboarding).mockResolvedValue({
    sessionId: "scan",
    state: "pending",
    qrUrl: "https://weixin.qq.com/scan",
    statusNote: "请扫码",
  });
  vi.mocked(h.adapter.pollOnboarding).mockResolvedValue({
    sessionId: "scan",
    state: "completed",
    connect: { id: "connected" } as never,
  });
  render(<WeixinWizard host={h} />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "用微信扫码连接" }));
  });
  expect(screen.getByRole("img", { name: "微信连接二维码" })).toHaveAttribute(
    "src",
    expect.stringContaining("data:image/svg+xml"),
  );
  expect(h.done).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
  expect(h.done).toHaveBeenCalledWith({ id: "connected" });
});
it("cancels an authorization that resolves after unmount", async () => {
  const h = host();
  let resolve!: (value: any) => void;
  vi.mocked(h.adapter.beginOnboarding).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const component = render(<WeixinWizard host={h} />);
  fireEvent.click(screen.getByRole("button", { name: "用微信扫码连接" }));
  component.unmount();
  await act(async () => resolve({ sessionId: "late", state: "pending" }));
  expect(h.adapter.cancelOnboarding).toHaveBeenCalledWith("late");
  expect(h.done).not.toHaveBeenCalled();
});
it("submits a code to the exact challenge and never puts it into account settings", async () => {
  const h = host();
  vi.mocked(h.adapter.beginOnboarding).mockResolvedValue({
    sessionId: "scan",
    state: "pending",
    input: { id: "challenge", label: "微信验证码" },
  });
  render(<WeixinWizard host={h} />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "用微信扫码连接" }));
  });
  fireEvent.change(screen.getByLabelText("微信验证码"), {
    target: { value: "123456" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "提交验证码" }));
  });
  expect(h.adapter.submitOnboardingInput).toHaveBeenCalledWith(
    "scan",
    "challenge",
    "123456",
  );
  expect(screen.getByLabelText("微信验证码")).toHaveValue("");
});
it("shows a retry action on QR failure", async () => {
  const h = host();
  vi.mocked(h.adapter.beginOnboarding).mockRejectedValue(
    new Error("weixin_qr_expired"),
  );
  render(<WeixinWizard host={h} />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "用微信扫码连接" }));
  });
  expect(screen.getByRole("alert")).toHaveTextContent("二维码已过期");
  expect(screen.getByRole("button", { name: "重新获取二维码" })).toBeEnabled();
});
