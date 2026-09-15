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

it("adds official card/footer content without changing native provider controls", async () => {
  vi.clearAllMocks();
  const card = {
    provider: { provider: "deepseek-official", displayName: "DeepSeek", settingsNs: "deepseek", settingsPath: [], active: true },
    configured: true, keyConfigured: true,
  };
  snapshot.mockResolvedValue({ ...modelPlaneSnapshot, providers: [{ ...modelPlaneSnapshot.providers[0], providerCard: card }] });
  const result = render(<ModelProviderConfigTab adapter={adapter} />);
  await screen.findByText("options.models.config.defaultsTitle");
  const native = result.container.querySelector("[data-provider-row]")!;
  const before = native.cloneNode(true);
  const renderCard = vi.fn(owner => <button>Card extension {owner.provider.provider}</button>);
  result.rerender(<ModelProviderConfigTab adapter={adapter} renderProviderCard={renderCard} footer={<button>Models footer</button>} />);
  await screen.findByRole("button", { name: "Models footer" });
  expect(renderCard).toHaveBeenCalledWith(card);
  expect(native.isEqualNode(before)).toBe(true);
  expect(result.container.querySelector("[data-provider-row]")).toBe(native);
  expect(screen.getByRole("button", { name: "Card extension deepseek-official" })).toBeVisible();
  const add = screen.getByRole("button", { name: "options.models.provider.addCustom" });
  expect(add.nextElementSibling).toBe(result.container.querySelector("[data-model-settings-footer]"));
  result.rerender(<ModelProviderConfigTab adapter={adapter} />);
  expect(result.container.querySelector("[data-model-settings-footer]")).toBeNull();
  expect(native.isEqualNode(before)).toBe(true);
});

it("isolates a throwing card renderer and footer while native configuration remains usable", async () => {
  vi.clearAllMocks();
  snapshot.mockResolvedValue({ ...modelPlaneSnapshot, providers: [{ ...modelPlaneSnapshot.providers[0], providerCard: {
    provider: { provider: "deepseek-official", displayName: "DeepSeek", settingsNs: "deepseek", settingsPath: [], active: true },
    configured: true, keyConfigured: false,
  } }] });
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const Broken = (): never => { throw new Error("model footer failure"); };
    render(<ModelProviderConfigTab adapter={adapter} footer={<Broken />} renderProviderCard={() => { throw new Error("model card failure"); }} />);
    await screen.findByText("options.models.config.defaultsTitle");
    expect(document.querySelector("[data-provider-row]")).toBeInTheDocument();
    expect(document.querySelector("[data-model-provider-extension]")?.childNodes).toHaveLength(0);
    expect(document.querySelector("[data-model-settings-footer]")?.childNodes).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "options.models.provider.addCustom" }));
    expect(await screen.findByRole("dialog")).toBeVisible();
  } finally { error.mockRestore(); }
});


it("shares the merged model inventory with the official editor and keeps it after refresh", async () => {
  snapshot.mockClear();
  snapshot.mockResolvedValue(modelPlaneSnapshot);
  const discover = vi.fn(async () => ({ models: modelPlaneSnapshot.providers[0]!.models }));
  const user = userEvent.setup();
  render(<ModelProviderConfigTab adapter={{ ...adapter, configure: vi.fn(), discover }} inventory={[{
    id: "deepseek-official", name: "DeepSeek", available: true,
    models: [{ id: "image-model", name: "Image Model", supported: true, enabled: true, outputModalities: ["image"] }],
  }]} />);
  await user.click(await screen.findByRole("button", { name: "options.models.display.configureProvider" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getAllByRole("listitem")).toHaveLength(3);
  expect(within(dialog).getByText("Image Model")).toBeVisible();
  snapshot.mockResolvedValue({ ...modelPlaneSnapshot, providers: [{
    ...modelPlaneSnapshot.providers[0]!,
    models: [...modelPlaneSnapshot.providers[0]!.models, { id: "new-chat", name: "New Chat" }],
  }] });
  await user.click(within(dialog).getByRole("button", { name: "provider.refresh" }));
  await waitFor(() => expect(discover).toHaveBeenCalledOnce());
  await waitFor(() => expect(snapshot).toHaveBeenCalledTimes(2));
  expect(within(dialog).getAllByRole("listitem")).toHaveLength(4);
});
