import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageContent } from "../page-content";

describe("PageContent", () => {
  it("applies the shared page geometry and lightweight title hierarchy", () => {
    const { container } = render(
      <PageContent title="Automation">
        <p>content</p>
      </PageContent>,
    );

    expect(container.firstChild).toHaveClass("max-w-4xl", "px-7", "pt-7");
    expect(screen.getByRole("heading", { name: "Automation" })).toHaveClass(
      "text-xl",
      "font-normal",
    );
  });

  it("centralizes named width and padding variants", () => {
    const { container } = render(
      <PageContent padding="none" size="md">
        Body
      </PageContent>,
    );

    expect(container.firstChild).toHaveClass("max-w-3xl");
    expect(container.firstChild).not.toHaveClass("px-7", "pt-7");
  });
});
