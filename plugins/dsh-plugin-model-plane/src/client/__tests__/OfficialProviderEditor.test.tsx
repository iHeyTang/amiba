import { installOfficialLocale } from "@amiba/i18n";
import { cleanup } from "@testing-library/react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    fireEvent.click(screen.getByText("Advanced settings"));
    fireEvent.change(screen.getByLabelText("Region"), {
      target: { value: '"west"' },
    });
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "new-test-key" },
    });
    fireEvent.submit(screen.getByLabelText("API address").closest("form")!);
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

afterEach(cleanup);
it.each(["deepseek", "openai", "anthropic", "community"])(
  "uses shared labels and preserves advanced values for %s",
  async (id) => {
    const dispose = installOfficialLocale({
      getSnapshot: () => ({ active: "zh" }),
      subscribe: () => () => {},
    });
    try {
      const original = {
        apiKeyEnv: "COMMUNITY_KEY",
        baseURL: "https://example.test",
        maxTokens: 4096,
        defaultContextWindow: 128000,
        reasoningEffort: "high",
        customOption: "unchanged",
      };
      const provider = {
        ...snapshot.providers[0]!,
        id,
        models: [{ id: "demo-chat", name: "Demo Chat" } as any],
        configuration: {
          ...snapshot.providers[0]!.configuration!,
          value: original,
          schema: {
            type: "object",
            dict: {
              apiKeyEnv: { type: "string", meta: { role: "credential-ref" } },
              baseURL: { type: "string" },
              maxTokens: { type: "number" },
              defaultContextWindow: { type: "number" },
              reasoningEffort: {
                type: "union",
                list: [
                  { type: "const", value: "low" },
                  { type: "const", value: "high" },
                ],
              },
              customOption: {
                type: "string",
                meta: { description: "Community option" },
              },
            },
          },
        },
      };
      const configure = vi.fn(async (_id: string, _input: unknown) => snapshot);
      render(
        <OfficialProviderEditor
          provider={provider}
          snapshot={snapshot}
          adapter={{ configure } as any}
          onClose={() => {}}
          onSaved={() => {}}
        />,
      );
      expect(screen.getByLabelText("API 密钥")).toHaveValue("");
      expect(screen.getByLabelText("接口地址")).toBeVisible();
      expect(screen.getByText("Demo Chat")).toBeVisible();
      expect(screen.queryByText("连接设置")).toBeNull();
      expect(screen.queryByText("模型与高级设置")).toBeNull();
      expect(screen.getByLabelText("回复长度上限")).not.toBeVisible();
      fireEvent.change(screen.getByLabelText("接口地址"), {
        target: { value: "https://new.example.test" },
      });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await waitFor(() =>
        expect(configure).toHaveBeenCalledWith(id, {
          expectedRevision: 4,
          ops: [
            { op: "set", path: ["baseURL"], value: "https://new.example.test" },
          ],
          credentials: [],
        }),
      );
      fireEvent.click(screen.getByText("高级设置"));
      expect(screen.getByLabelText("回复长度上限")).toBeVisible();
      expect(screen.getByLabelText("对话上下文容量")).toHaveValue(128000);
      expect(screen.getByRole("option", { name: "高" })).toHaveValue('"high"');
      expect(screen.getByLabelText("Community option")).toHaveValue(
        "unchanged",
      );
      fireEvent.change(screen.getByLabelText("回复长度上限"), {
        target: { value: "8192" },
      });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await waitFor(() =>
        expect(configure.mock.calls[1]?.[1]).toMatchObject({
          ops: [
            { op: "set", path: ["baseURL"], value: "https://new.example.test" },
            { op: "set", path: ["maxTokens"], value: 8192 },
          ],
        }),
      );
    } finally {
      cleanup();
      dispose();
    }
  },
);
