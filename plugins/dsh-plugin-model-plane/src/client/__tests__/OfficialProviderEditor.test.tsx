import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  OfficialProviderEditor,
  configurationDiff,
} from "../OfficialProviderEditor.js";
import type { ProviderSettingsController } from "../ModelProviderConfigTab.js";
import type { ModelPlaneSnapshotShape } from "../view-types.js";

const snapshot: ModelPlaneSnapshotShape = {
  revision: 1,
  groups: [],
  credentials: { COMMUNITY_KEY: { configured: true, writable: true } },
  failures: [],
  providers: [
    {
      id: "community",
      displayName: "Community provider",
      protocol: "provider-native",
      enabled: true,
      editable: true,
      source: "builtin",
      models: [],
      configuration: {
        namespace: "community",
        revision: 4,
        path: [],
        removable: false,
        credentialFields: [{ path: ["token"], ref: "COMMUNITY_KEY" }],
        value: {
          token: "COMMUNITY_KEY",
          endpoint: "https://old.example",
          advanced: { region: "east" },
        },
        schema: {
          type: "object",
          dict: {
            token: {
              type: "string",
              meta: { role: "credential-ref", description: "API key" },
            },
            endpoint: { type: "string", meta: { description: "Endpoint" } },
            advanced: {
              type: "object",
              dict: {
                region: {
                  type: "union",
                  list: [
                    { type: "const", value: "east" },
                    { type: "const", value: "west" },
                  ],
                  meta: { description: "Region" },
                },
              },
            },
          },
        },
      },
    },
  ],
};
describe("official-schema editor with Amiba UI", () => {
  it("renders unknown provider fields and sends only changed paths with the official revision", async () => {
    const configure = vi.fn(async () => snapshot);
    const onSaved = vi.fn();
    render(
      <OfficialProviderEditor
        provider={snapshot.providers[0]!}
        snapshot={snapshot}
        adapter={
          {
            configure,
            snapshot: async () => snapshot,
          } as unknown as ProviderSettingsController
        }
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );
    expect(screen.getByLabelText("API key")).toHaveValue("");
    expect(screen.queryByDisplayValue("COMMUNITY_KEY")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Region"), {
      target: { value: '"west"' },
    });
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "new-test-key" },
    });
    fireEvent.submit(screen.getByLabelText("Endpoint").closest("form")!);
    await waitFor(() =>
      expect(configure).toHaveBeenCalledWith("community", {
        expectedRevision: 4,
        ops: [{ op: "set", path: ["advanced", "region"], value: "west" }],
        credentials: [{ ref: "COMMUNITY_KEY", value: "new-test-key" }],
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });
  it("does not rewrite untouched nested fields or redacted secrets", () => {
    expect(
      configurationDiff(
        { endpoint: "old", hidden: {} },
        { endpoint: "new", hidden: {} },
      ),
    ).toEqual([{ op: "set", path: ["endpoint"], value: "new" }]);
  });
});
