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
        detail="The runtime returned an invalid response."
        onDismiss={vi.fn()}
        title="Runtime request failed"
      />,
    );

    expect(
      screen.getByText("Runtime request failed"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("The runtime returned an invalid response."),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "composer.notice.showDetails",
      }),
    );

    expect(
      screen.getByText("The runtime returned an invalid response."),
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
