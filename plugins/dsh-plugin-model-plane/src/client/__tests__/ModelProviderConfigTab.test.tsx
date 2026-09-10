import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Key-echo both i18n surfaces: the component's own overlay hook
// (`usePluginT` via `@amiba/i18n/plugin`) and the host `useT` that the
// shared `@amiba/ui` model primitives (ModelPickerDialog, ModelInfoCard)
// still call internally — assertions below match raw keys either way.
vi.mock("@amiba/i18n", () => {
  const t = (key: string) => key;
  return { useT: () => ({ t }) };
});
vi.mock("@amiba/i18n/plugin", () => {
  const t = (key: string) => key;
  return { usePluginT: () => ({ t }) };
});

import {
  ModelProviderConfigTab,
  type ProviderSettingsController,
} from "../ModelProviderConfigTab";

const snapshot = vi.fn();
const upsert = vi.fn();
const setDefaultSelection = vi.fn();

const adapter: ProviderSettingsController = {
  snapshot,
  setDefaultSelection,
  upsert,
  remove: vi.fn(),
  discover: vi.fn(),
  unsetCredential: vi.fn(),
};

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
  });

  it("restores the model-first settings hierarchy on top of Model Plane", async () => {
    const user = userEvent.setup();
    render(<ModelProviderConfigTab adapter={adapter} assignments={<div data-testid="media-assignments">Media assignments</div>} />);

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
    const mainRow = document.querySelector('[data-model-assignment="main"]')!;
    expect(within(mainRow as HTMLElement).getByRole("combobox", {
      name: "sidepanel.modelPicker.reasoningEffort",
    })).toBeVisible();
    expect(screen.getByTestId("media-assignments").closest("[data-model-settings-surface]"))
      .toBe(mainRow.closest("[data-model-settings-surface]"));
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
  it("keeps a keyless provider switch off, while retaining its advertised catalog for configuration", async () => {
    snapshot.mockResolvedValue({
      ...modelPlaneSnapshot,
      defaultSelection: undefined,
      providers: [
        {
          ...modelPlaneSnapshot.providers[0],
          enabled: false,
          availability: "missing-credential",
          visibilityEditable: true,
        },
      ],
      credentials: { DEEPSEEK_API_KEY: { configured: false, writable: true } },
    });
    const user = userEvent.setup();
    render(<ModelProviderConfigTab adapter={adapter} />);
    const toggle = await screen.findByRole("switch", {
      name: "options.models.display.providerToggle",
    });
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeDisabled();
    expect(
      screen.getByText("options.dshModels.availability.missing-credential"),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: /options\.models\.config\.main/ }),
    );
    const picker = await screen.findByRole("dialog", {
      name: "options.models.config.pickerTitle",
    });
    expect(
      within(picker).queryByRole("option", { name: /DeepSeek V4/ }),
    ).not.toBeInTheDocument();
    expect(upsert).not.toHaveBeenCalled();
  });
});

it("includes provider media inventory in search without adding it to chat choices", async () => {
  snapshot.mockResolvedValue(modelPlaneSnapshot);
  const user = userEvent.setup();
  render(<ModelProviderConfigTab adapter={adapter} inventory={[{
    id:"deepseek-official", name:"DeepSeek", available:true, models:[
      {id:"seedream",name:"Seedream Image",description:"Image creation",supported:true,outputModalities:["image"]},
      {id:"seedance",name:"Seedance Video",supported:true,outputModalities:["video"]},
      {id:"speech",name:"Speech Audio",supported:true,outputModalities:["audio"]},
      {id:"future",name:"Future model",supported:false},
    ],
  }]} />);
  await screen.findByText("options.models.config.defaultsTitle");
  await user.type(screen.getByPlaceholderText("options.models.display.search"), "seed");
  expect(screen.getByText("Seedream Image")).toBeVisible();
  expect(screen.getByText("Seedance Video")).toBeVisible();
  expect(document.querySelector('[data-model-row="seedream"] input[role="switch"]')).toBeNull();
  await user.click(screen.getByRole("button",{name:/options.models.config.main/}));
  const picker = screen.getByRole("dialog");
  expect(within(picker).queryByRole("option",{name:/Seedream/})).toBeNull();
});
