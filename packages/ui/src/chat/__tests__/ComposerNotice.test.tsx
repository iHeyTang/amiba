import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import { ComposerNotice } from "../ComposerNotice";

describe("ComposerNotice", () => {
  it("keeps diagnostics collapsed until requested", async () => {
    const user = userEvent.setup();
    render(
      <ComposerNotice
        detail="No STT provider available. Configure a provider."
        onDismiss={vi.fn()}
        title="Voice transcription isn't configured"
      />,
    );

    expect(
      screen.getByText("Voice transcription isn't configured"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No STT provider available. Configure a provider."),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "composer.notice.showDetails",
      }),
    );

    expect(
      screen.getByText("No STT provider available. Configure a provider."),
    ).toBeInTheDocument();
  });

  it("can be dismissed without touching composer state", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <ComposerNotice
        detail="diagnostic"
        onDismiss={onDismiss}
        title="Failed"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "notifier.dismiss" }),
    );

    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
