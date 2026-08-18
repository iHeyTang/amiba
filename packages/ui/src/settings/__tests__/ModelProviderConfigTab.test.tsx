import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatform, type PlatformAdapter } from "@amiba/app-runtime/platform";

vi.mock("@amiba/i18n", () => {
  const t = (key: string) => key;
  return { useT: () => ({ t }) };
});

import { ModelProviderConfigTab } from "../ModelProviderConfigTab";

const snapshot = vi.fn();
const upsert = vi.fn();
const setDefaultSelection = vi.fn();

const modelPlaneSnapshot = {
  revision: 4,
  providers: [
    {
      id: "deepseek-official",
      displayName: "DeepSeek",
      protocol: "deepseek-chat-completions" as const,
      baseURL: "https://api.deepseek.com",
      credentialRef: "DEEPSEEK_API_KEY",
      enabled: true,
      editable: true,
      source: "builtin" as const,
      models: [
        { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
        {
          id: "deepseek-v4-pro",
          name: "DeepSeek V4 Pro",
          reasoning: {
            defaultEffort: "high",
            efforts: [
              { id: "off", name: "Off" },
              { id: "high", name: "High" },
              { id: "max", name: "Max" },
            ],
          },
        },
      ],
    },
  ],
  groups: [],
  defaultSelection: {
    provider: "deepseek-official",
    model: "deepseek-v4-pro",
    reasoningEffort: "high",
  },
  credentials: {
    DEEPSEEK_API_KEY: {
      configured: true,
      source: "environment",
      writable: true,
    },
  },
  failures: [],
};

describe("ModelProviderConfigTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    snapshot.mockResolvedValue(modelPlaneSnapshot);
    upsert.mockResolvedValue({ ...modelPlaneSnapshot, revision: 5 });
    setDefaultSelection.mockResolvedValue({
      ...modelPlaneSnapshot,
      revision: 5,
      defaultSelection: {
        provider: "deepseek-official",
        model: "deepseek-v4-flash",
      },
    });
    setPlatform({
      storage: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn(),
        remove: vi.fn(),
        watch: vi.fn(() => () => {}),
      },
      modelPlane: {
        snapshot,
        setDefaultSelection,
        upsert,
        remove: vi.fn(),
        discover: vi.fn(),
        unsetCredential: vi.fn(),
      },
    } as unknown as PlatformAdapter);
  });

  it("restores the model-first settings hierarchy on top of Model Plane", async () => {
    const user = userEvent.setup();
    render(<ModelProviderConfigTab />);

    expect(
      await screen.findByText("options.models.config.defaultsTitle"),
    ).toBeVisible();
    expect(screen.getByText("options.models.display.title")).toBeVisible();
    expect(screen.getByText("DeepSeek V4 Pro")).toBeVisible();
    expect(
      screen.getByRole("combobox", {
        name: "sidepanel.modelPicker.reasoningEffort",
      }),
    ).toBeVisible();
    expect(
      document.querySelectorAll("[data-model-settings-surface]"),
    ).toHaveLength(2);
    expect(snapshot).toHaveBeenCalledOnce();

    await user.click(
      screen.getByRole("button", {
        name: /options\.models\.config\.main/,
      }),
    );
    const picker = await screen.findByRole("dialog", {
      name: "options.models.config.pickerTitle",
    });
    await user.click(
      within(picker).getByRole("option", { name: /DeepSeek V4 Flash/ }),
    );
    await waitFor(() => expect(setDefaultSelection).toHaveBeenCalledOnce());
    expect(setDefaultSelection).toHaveBeenCalledWith(
      {
        provider: "deepseek-official",
        model: "deepseek-v4-flash",
      },
      4,
    );

    await user.click(
      screen.getByRole("button", {
        name: "options.models.display.configureProvider",
      }),
    );
    const providerDialog = await screen.findByRole("dialog", {
      name: "DeepSeek",
    });
    expect(providerDialog).toHaveAttribute("data-provider-config-dialog");
    expect(
      providerDialog.querySelector("[data-provider-config-scroll]"),
    ).toBeInTheDocument();
    expect(within(providerDialog).getByText("DeepSeek V4 Pro")).toBeVisible();
    expect(
      within(providerDialog).queryByRole("textbox", {
        name: "options.dshModels.modelCatalog",
      }),
    ).not.toBeInTheDocument();
    await user.click(
      within(providerDialog).getByRole("button", { name: "common.save" }),
    );

    await waitFor(() => expect(upsert).toHaveBeenCalledOnce());
    expect(upsert).toHaveBeenCalledWith({
      provider: modelPlaneSnapshot.providers[0],
      expectedRevision: 5,
    });
  });
});
