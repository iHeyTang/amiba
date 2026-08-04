import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProviderConnectionStatusBadge } from "../ProviderConnectionStatusBadge";
import { ProviderCredentialEditor } from "../ProviderCredentialEditor";

describe("ProviderCredentialEditor", () => {
  it("keeps connection status out of the credential form", () => {
    render(
      <ProviderCredentialEditor
        authHint=""
        authType="copilot"
        connection={{
          status: "verified",
          active_method: "external:github_cli",
          methods: [
            {
              id: "external:github_cli",
              kind: "external_cli",
              source: "github_cli",
              field_key: "",
              configured: false,
              detected: true,
              editable: false,
              status: "active",
            },
          ],
          service: { status: "verified", reason: "" },
        }}
        error={null}
        fields={[]}
        loading={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
        provider="copilot"
        saved={false}
        saving={false}
        values={{}}
      />,
    );

    expect(screen.queryByText("Current connection")).not.toBeInTheDocument();
    expect(screen.queryByText("Connection methods")).not.toBeInTheDocument();
  });

  it("reveals layered Copilot status from the compact title badge", async () => {
    const user = userEvent.setup();
    render(
      <ProviderConnectionStatusBadge
        connection={{
          status: "unavailable",
          active_method: "external:github_cli",
          methods: [
            {
              id: "external:github_cli",
              kind: "external_cli",
              source: "github_cli",
              field_key: "",
              configured: false,
              detected: true,
              editable: false,
              status: "active",
            },
          ],
          service: {
            status: "unavailable",
            reason: "copilot_access_denied",
          },
        }}
        fields={[]}
        provider="copilot"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Unavailable" }));
    const details = screen.getByRole("dialog", {
      name: "Connection details",
    });
    expect(details).toHaveTextContent("GitHub CLI login");
    expect(details).toHaveTextContent("Copilot service");
    expect(details).toHaveTextContent("Service unavailable");
    expect(details).toHaveTextContent(
      "GitHub is signed in, but no usable Copilot service credential was issued",
    );
  });

  it("does not present an unverified GitHub identity as a usable connection", () => {
    render(
      <ProviderConnectionStatusBadge
        connection={{
          status: "verification_required",
          active_method: "env:GH_TOKEN",
          active_scope: "system",
          methods: [
            {
              id: "env:GH_TOKEN",
              kind: "oauth_token",
              source: "environment",
              field_key: "GH_TOKEN",
              configured: false,
              detected: true,
              editable: true,
              status: "active",
              scope: "system",
            },
          ],
          service: { status: "not_checked", reason: "" },
        }}
        fields={[]}
        provider="copilot"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Verification required" }),
    ).toBeInTheDocument();
  });
});
