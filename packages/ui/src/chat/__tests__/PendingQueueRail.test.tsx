import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import { PendingQueueRail } from "../internal/PendingQueueRail";

describe("PendingQueueRail", () => {
  it("renders queued turns as full-width context rows", async () => {
    const onSendNow = vi.fn();
    const onEdit = vi.fn();
    const onRemove = vi.fn();

    render(
      <PendingQueueRail
        items={[{ queueId: "queue-1", preview: "Check the failing tests" }]}
        editingQueueId={null}
        onSendNow={onSendNow}
        onEdit={onEdit}
        onRemove={onRemove}
      />,
    );

    const rail = screen.getByRole("list", {
      name: "sidepanel.queue.tooltip",
    });
    expect(rail).toHaveClass("flex", "flex-col");
    expect(rail).not.toHaveClass("overflow-x-auto", "divide-y", "border", "shadow-sm");

    const row = screen.getByRole("listitem");
    expect(row).toHaveClass("w-full");

    await userEvent.click(
      screen.getByRole("button", { name: "sidepanel.queue.edit.aria" }),
    );
    expect(onEdit).toHaveBeenCalledWith("queue-1");

    await userEvent.click(
      screen.getByRole("button", { name: "sidepanel.queue.sendNow.aria" }),
    );
    expect(onSendNow).toHaveBeenCalledWith("queue-1");

    await userEvent.click(
      screen.getByRole("button", { name: "sidepanel.queue.delete" }),
    );
    expect(onRemove).toHaveBeenCalledWith("queue-1");
  });
});
