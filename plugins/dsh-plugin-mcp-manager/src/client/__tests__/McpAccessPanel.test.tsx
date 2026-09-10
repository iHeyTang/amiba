import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { McpAccessPanel, type McpAccessAdapter } from "../McpAccessPanel.js";
import type { McpAccessView } from "../../access.js";

const item: McpAccessView = {
  id: "internal-consumer-key", plugin: "Knowledge", name: "Search documents", serviceId: "documents", version: "1", audience: "plugin",
  tools: [{ name: "internal_read_tool", title: "Read documents", description: "Find and read shared documents" }],
  connections: [{ id: "internal-connection-key", name: "Work account", provider: "Feishu", approvalToken: "review-token" }],
  state: "approval-required",
};

it("shows capabilities and connection names, then submits the exact reviewed selection", async () => {
  const approved = { ...item, connectionId: "internal-connection-key", state: "ready" as const };
  const adapter: McpAccessAdapter = {
    list: vi.fn(async () => [item]), approve: vi.fn(async () => [approved]), revoke: vi.fn(async () => [item]), retry: vi.fn(), openConnections: vi.fn(),
  };
  const { container } = render(<McpAccessPanel adapter={adapter} />);
  await screen.findByText("Knowledge");
  expect(screen.getByText("Read documents")).toBeInTheDocument();
  expect(container.textContent).not.toContain("internal-");
  expect(container.textContent).not.toContain("internal_read_tool");
  expect(container.textContent).not.toContain("review-token");
  const approve = screen.getByRole("button", { name: /Approve access|批准使用/ });
  expect(approve).toBeDisabled();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "internal-connection-key" } });
  fireEvent.click(approve);
  await waitFor(() => expect(adapter.approve).toHaveBeenCalledWith(item.id, "internal-connection-key", "review-token"));
  fireEvent.click(await screen.findByRole("button", { name: /Revoke access|撤销使用/ }));
  await waitFor(() => expect(adapter.revoke).toHaveBeenCalledWith(item.id));
  fireEvent.click(screen.getByRole("button", { name: /Manage connections|管理连接/ }));
  expect(adapter.openConnections).toHaveBeenCalledOnce();
});

it("distinguishes feature failure and retries without granting new permissions", async () => {
  const failed: McpAccessView = { ...item, connectionId: "internal-connection-key", state: "error", code: "mcp_feature_activation_failed" };
  const adapter: McpAccessAdapter = {
    list: vi.fn(async () => [failed]), approve: vi.fn(), revoke: vi.fn(),
    retry: vi.fn(async () => [{ ...failed, state: "ready" as const, code: undefined }]), openConnections: vi.fn(),
  };
  render(<McpAccessPanel adapter={adapter} />);
  await screen.findByText("Plugin feature could not start");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("Available");
  expect(adapter.retry).toHaveBeenCalledWith(item.id);
  expect(adapter.approve).not.toHaveBeenCalled();
});

it("identifies other consumers without exposing runtime sharing controls", async () => {
  const adapter: McpAccessAdapter = {
    list: vi.fn(async () => [
      { ...item, connectionId: "internal-connection-key", state: "ready" as const },
      { ...item, id: "other", plugin: "Search", connectionId: "internal-connection-key", state: "ready" as const },
    ]),
    approve: vi.fn(), revoke: vi.fn(), retry: vi.fn(), openConnections: vi.fn(),
  };
  const { container } = render(<McpAccessPanel adapter={adapter} />);
  await screen.findByText("Knowledge");
  expect(container.textContent).toMatch(/Also approved for: Search|也已获准使用此连接：Search/);
  expect(container.textContent).not.toMatch(/isolated|shared runtime|实例/);
});

it("shows retained approval on its connection detail and permits revocation while inactive", async () => {
  const configuration = { ownerId: "connector-core", recordId: "work" };
  const retained: McpAccessView = { ...item, configuration, connectionId: "internal-connection-key",
    connectionName: "Work account", connections: [], state: "inactive" };
  const adapter: McpAccessAdapter = {
    list: vi.fn(async () => [retained, { ...retained, id: "unrelated", plugin: "Unrelated", configuration: { ...configuration, recordId: "other" } }]),
    approve: vi.fn(), revoke: vi.fn(async () => []), retry: vi.fn(), openConnections: vi.fn(),
  };
  render(<McpAccessPanel adapter={adapter} configuration={configuration} />);
  await screen.findByText("Knowledge");
  expect(screen.queryByText("Unrelated")).not.toBeInTheDocument();
  expect(screen.getByText("Work account")).toBeInTheDocument();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Revoke access|撤销使用/ }));
  await waitFor(() => expect(adapter.revoke).toHaveBeenCalledWith(item.id));
});
