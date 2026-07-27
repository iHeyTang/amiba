import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import { PendingQueueRail } from "../internal/PendingQueueRail";

describe("PendingQueueRail", () => {
  it("renders queued turns as compact context tabs", async () => {
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
    expect(rail).toHaveClass("flex", "overflow-x-auto");
    expect(rail).not.toHaveClass("divide-y", "border", "shadow-sm");

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
