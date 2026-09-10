import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ResourcePreview } from "./ResourcePreview.js";
import type { ResourcesRemote } from "../remote.js";
const ref = {
  source: "lark",
  connectionId: "work",
  identity: "alice",
  kind: "docx",
  id: "doc",
};
const doc = {
  ref,
  title: "项目文档",
  account: "工作账号",
  text: "<script>Do not execute this</script>",
  truncated: false,
};
const remote = (): ResourcesRemote => ({
  read: vi.fn(async () => ({ ok: true as const, value: doc })),
  reference: vi.fn(),
  search: vi.fn(),
});
afterEach(cleanup);
describe("resource preview", () => {
  it("reads only for the human preview and renders external content as text", async () => {
    const adapter = remote(),
      send = vi.fn();
    render(
      <ResourcePreview
        reference={ref}
        remote={adapter}
        send={send}
        close={() => {}}
      />,
    );
    expect(await screen.findByText(doc.text)).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
    expect(send).not.toHaveBeenCalled();
    expect(adapter.reference).not.toHaveBeenCalled();
  });
  it("keeps the human preview when Agent access is denied", async () => {
    document.documentElement.lang = "zh-CN";
    render(
      <ResourcePreview
        reference={ref}
        remote={remote()}
        send={async () => {
          throw new Error("denied");
        }}
        close={() => {}}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "交给 Agent" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(doc.text)).toBeTruthy();
  });
  it("does not reuse content from a previous identity while another read is pending", async () => {
    const adapter = remote(),
      close = () => {},
      send = async () => {};
    const view = render(
      <ResourcePreview
        reference={ref}
        remote={adapter}
        send={send}
        close={close}
      />,
    );
    await screen.findByText(doc.text);
    adapter.read = vi.fn<ResourcesRemote["read"]>(
      () => new Promise(() => undefined),
    );
    view.rerender(
      <ResourcePreview
        reference={{ ...ref, identity: "bob" }}
        remote={adapter}
        send={send}
        close={close}
      />,
    );
    expect(screen.queryByText(doc.text)).toBeNull();
  });
});
