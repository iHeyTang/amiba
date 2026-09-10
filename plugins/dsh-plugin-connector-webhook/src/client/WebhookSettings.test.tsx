import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebhookSettings } from "./WebhookSettings.js";
import { endpoint, newToken, senderList } from "./WebhookFields.js";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-amiba-dsh-base-url");
});
const connect = {
  id: "connect-a",
  provider: "webhook",
  name: "Custom",
  enabled: true,
  pairing: false,
  owners: [],
  status: { state: "ready" as const },
  createdAt: "now",
  updatedAt: "now",
};
describe("Webhook account settings", () => {
  it("uses the managed runtime origin, not the desktop renderer origin", () => {
    document.documentElement.setAttribute(
      "data-amiba-dsh-base-url",
      "http://127.0.0.1:9999",
    );
    expect(endpoint("a")).toBe(
      "http://127.0.0.1:9999/api/amiba/connectors/webhook/a",
    );
    expect(newToken()).toMatch(/^[a-f0-9]{64}$/u);
    expect(senderList(" alice，bob,alice ")).toEqual(["alice", "bob"]);
  });
  it("only reveals a new credential after the save succeeds", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async (_patch: unknown) => undefined);
    render(
      <WebhookSettings
        host={{
          connect,
          settings: {
            outboundUrl: "https://example.com",
            allowedSenders: ["alice"],
          },
          save,
        }}
      />,
    );
    expect(screen.queryByText("Bearer credential")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Generate a new credential" }),
    );
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        token: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(await screen.findByText("Bearer credential")).toBeVisible();
    expect(screen.getByLabelText("Reply URL")).toHaveValue(
      "https://example.com",
    );
    expect(screen.getByLabelText("Allowed senders")).toHaveValue("alice");
    expect(
      screen.getByRole("button", { name: "Copy Bearer credential" }),
    ).not.toHaveAttribute("title");
  });
  it("keeps an unsuccessful credential rotation hidden and reports the error", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => {
      throw new Error("failed");
    });
    render(<WebhookSettings host={{ connect, settings: {}, save }} />);
    await user.click(
      screen.getByRole("button", { name: "Generate a new credential" }),
    );
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByText("Bearer credential")).not.toBeInTheDocument();
  });
});
