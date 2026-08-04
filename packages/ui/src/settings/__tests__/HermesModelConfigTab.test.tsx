import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const gateway = vi.hoisted(() => ({
  catalog: {
    peek: vi.fn(),
    read: vi.fn(),
    watch: vi.fn(() => () => undefined),
  },
  main: {
    write: vi.fn(),
  },
  display: {
    watch: vi.fn(() => () => undefined),
    setProviderVisibility: vi.fn(),
    setModelVisibility: vi.fn(),
  },
  provider: {
    readCredentials: vi.fn(),
    readModels: vi.fn(),
    writeCredentials: vi.fn(),
  },
  summaries: {
    watch: vi.fn(() => () => undefined),
  },
  workspace: {
    read: vi.fn(),
    readConfiguration: vi.fn(),
  },
}));

vi.mock("@amiba/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@amiba/core")>();
  return {
    ...actual,
    hermesModelGateway: {
      ...actual.hermesModelGateway,
      ...gateway,
      catalog: {
        ...actual.hermesModelGateway.catalog,
        ...gateway.catalog,
      },
      main: {
        ...actual.hermesModelGateway.main,
        ...gateway.main,
      },
      display: {
        ...actual.hermesModelGateway.display,
        ...gateway.display,
      },
      provider: {
        ...actual.hermesModelGateway.provider,
        ...gateway.provider,
      },
      summaries: {
        ...actual.hermesModelGateway.summaries,
        ...gateway.summaries,
      },
      workspace: gateway.workspace,
    },
  };
});

import { HermesModelConfigTab } from "../HermesModelConfigTab";

describe("HermesModelConfigTab", () => {
  beforeEach(() => {
    gateway.workspace.read.mockResolvedValue({
      main: {
        ok: true,
        provider: "openai",
        model: "gpt-5-mini",
        effective_context_length: 1_000_000,
        capabilities: {
          supports_reasoning: true,
          supports_tools: true,
        },
      },
      catalog: {
        ok: true,
        canonical_loaded: true,
        provider_ids: ["openai", "openrouter", "moa"],
        config_provider_ids: ["openai", "openrouter"],
        env_ready_provider_ids: [],
        authenticated_provider_ids: ["openai", "openrouter", "moa"],
        canonical_providers: [
          {
            slug: "openai",
            label: "OpenAI",
            tui_desc: "OpenAI",
          },
          {
            slug: "openrouter",
            label: "OpenRouter",
            tui_desc: "OpenRouter",
          },
        ],
        providers: {
          openai: {
            models: [
              {
                id: "gpt-5-mini",
                supplemental: {
                  source: "models.dev",
                  description: "GPT-5 mini",
                  metadata: {
                    context_window: 2_000_000,
                    reasoning: true,
                  },
                },
              },
            ],
          },
          openrouter: {
            models: [
              {
                id: "anthropic/claude-sonnet",
                description: "Claude Sonnet",
              },
            ],
          },
          moa: {
            source: "virtual",
            auth_type: "virtual",
            authenticated: true,
            models: [{ id: "review" }],
          },
        },
      },
      auxiliary: {
        ok: true,
        tasks: [
          {
            task: "vision",
            provider: "auto",
            model: "",
            base_url: "",
          },
        ],
      },
      moa: {
        ok: true,
        configured: true,
        default_preset: "review",
        active_preset: "",
        presets: {
          review: {
            enabled: true,
            reference_models: [{ provider: "openai", model: "gpt-5-mini" }],
            aggregator: { provider: "openai", model: "gpt-5-mini" },
            reference_temperature: null,
            aggregator_temperature: null,
            max_tokens: 4096,
          },
        },
        reference_models: [{ provider: "openai", model: "gpt-5-mini" }],
        aggregator: { provider: "openai", model: "gpt-5-mini" },
        reference_temperature: null,
        aggregator_temperature: null,
        max_tokens: 4096,
        enabled: true,
      },
      displayPreferences: {
        version: 1,
        providerOverrides: { openrouter: false },
        hiddenModels: {},
      },
      selectedModelSummaries: [
        {
          provider: "openai",
          model: "gpt-5-mini",
          entry: {
            id: "gpt-5-mini",
            description: "GPT-5 mini",
            metadata: {
              context_window: 1_000_000,
              supports_reasoning: true,
              supports_tools: true,
            },
          },
          updatedAt: 1,
        },
      ],
    });
    gateway.provider.readCredentials.mockResolvedValue({
      ok: true,
      provider: "openai",
      fields: [],
      auth_hint: "Uses an existing login",
    });
    gateway.provider.readModels.mockResolvedValue({
      ok: true,
      provider: "openai",
      models: [
        {
          id: "gpt-5-mini",
          supplemental: {
            source: "models.dev",
            description: "GPT-5 mini",
            metadata: {
              context_window: 1_000_000,
              reasoning: true,
            },
          },
        },
      ],
    });
    gateway.provider.writeCredentials.mockResolvedValue({
      ok: true,
      provider: "openai",
      written: [],
    });
    gateway.main.write.mockResolvedValue({
      ok: true,
      provider: "moa",
      model: "review",
    });
    gateway.workspace.readConfiguration.mockImplementation(async () => {
      const workspace = await gateway.workspace.read();
      return {
        main: workspace.main,
        auxiliary: workspace.auxiliary,
        moa: workspace.moa,
        displayPreferences: workspace.displayPreferences,
        selectedModelSummaries: workspace.selectedModelSummaries,
      };
    });
    gateway.catalog.peek.mockReturnValue(null);
    gateway.catalog.read.mockImplementation(async () => {
      const workspace = await gateway.workspace.read();
      return workspace.catalog;
    });
    gateway.catalog.watch.mockReturnValue(() => undefined);
  });

  it("combines task defaults and providers, then configures providers in a dialog", async () => {
    const user = userEvent.setup();
    render(<HermesModelConfigTab />);

    expect(await screen.findByText("Model assignments")).toBeInTheDocument();
    expect(screen.getByText("Auxiliary models")).toBeInTheDocument();
    expect(screen.queryByText("Reasoning")).not.toBeInTheDocument();
    expect(screen.queryByText("Tool calling")).not.toBeInTheDocument();
    expect(screen.getByText("Service providers")).toBeInTheDocument();
    expect(screen.queryByText("Catalog ready")).not.toBeInTheDocument();
    const assignmentsSection = screen
      .getByText("Model assignments")
      .closest("section");
    const providersSection = screen
      .getByText("Service providers")
      .closest("section");
    expect(assignmentsSection).toHaveClass("space-y-4");
    expect(providersSection).toHaveClass("space-y-4");
    expect(
      assignmentsSection?.querySelector("[data-model-settings-surface]"),
    ).toHaveClass("rounded-xl", "border-border/70");
    expect(
      providersSection?.querySelector("[data-model-settings-surface]"),
    ).toHaveClass("rounded-xl", "border-border/70");

    await user.click(
      screen.getByRole("button", { name: /OpenAI/i, expanded: false }),
    );
    expect(screen.getByText("1M")).toBeInTheDocument();
    expect(screen.getByText("Reasoning")).toBeInTheDocument();
    expect(screen.getByText("Tool calling")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "View details for gpt-5-mini",
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Configure OpenAI" }));

    const providerDialog = await screen.findByRole("dialog", {
      name: "OpenAI",
    });
    expect(providerDialog).toBeInTheDocument();
    expect(providerDialog).toHaveAttribute("data-provider-config-dialog");
    expect(providerDialog).toHaveClass(
      "h-[min(85vh,52rem)]",
      "!flex",
      "overflow-hidden",
    );
    expect(
      providerDialog.querySelector("[data-provider-config-scroll]"),
    ).toHaveClass("h-0", "min-h-0", "flex-1");
    expect(
      within(providerDialog).queryByText("Credentials"),
    ).not.toBeInTheDocument();
    expect(
      within(providerDialog).queryByText("openai"),
    ).not.toBeInTheDocument();
    expect(
      within(providerDialog).getByText("Uses an existing login"),
    ).toBeInTheDocument();
    expect(within(providerDialog).getByText("1M")).toBeInTheDocument();
    expect(within(providerDialog).getByText("Reasoning")).toBeInTheDocument();

    await user.click(
      await within(providerDialog).findByRole("button", {
        name: "View details for gpt-5-mini",
      }),
    );
    const detailsDialog = await screen.findByRole("dialog", {
      name: "GPT-5 mini",
    });
    expect(detailsDialog).toBeInTheDocument();
    expect(within(detailsDialog).getByText("1M")).toBeInTheDocument();
    expect(within(detailsDialog).getByText("Reasoning")).toBeInTheDocument();
  });

  it("renders local assignments while the shared model catalog is still loading", async () => {
    const workspace = await gateway.workspace.read();
    let resolveCatalog: ((value: typeof workspace.catalog) => void) | undefined;
    gateway.catalog.read.mockReturnValue(
      new Promise((resolve) => {
        resolveCatalog = resolve;
      }),
    );

    const user = userEvent.setup();
    render(<HermesModelConfigTab />);

    expect(await screen.findByText("Model assignments")).toBeInTheDocument();
    expect(
      document.querySelector("[data-model-catalog-loading]"),
    ).toBeInTheDocument();
    expect(screen.getByText("GPT-5 mini")).toBeInTheDocument();
    expect(screen.getByText("gpt-5-mini")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: /Default model/,
      }),
    );
    const picker = await screen.findByRole("dialog", {
      name: "Choose a model for Default model",
    });
    expect(
      within(picker).getByText("Loading available models…"),
    ).toBeInTheDocument();

    resolveCatalog?.(workspace.catalog);
    expect(
      await within(picker).findByRole("option", { name: /GPT-5 mini/ }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        document.querySelector("[data-model-catalog-loading]"),
      ).not.toBeInTheDocument(),
    );
  });

  it("keeps a local collaboration preset neutral until providers are known", async () => {
    const workspace = await gateway.workspace.read();
    let resolveCatalog: ((value: typeof workspace.catalog) => void) | undefined;
    gateway.catalog.read.mockReturnValue(
      new Promise((resolve) => {
        resolveCatalog = resolve;
      }),
    );

    render(<HermesModelConfigTab view="multi-model-collaboration" />);

    expect(await screen.findByText("Model pipeline")).toBeInTheDocument();
    expect(screen.getAllByText("GPT-5 mini").length).toBeGreaterThan(0);
    expect(
      document.querySelector("[data-moa-warning]"),
    ).not.toBeInTheDocument();
    document
      .querySelectorAll("[data-moa-slot-status]")
      .forEach((status) =>
        expect(status).toHaveClass("bg-muted-foreground/30"),
      );

    resolveCatalog?.(workspace.catalog);
    await waitFor(() =>
      document
        .querySelectorAll("[data-moa-slot-status]")
        .forEach((status) =>
          expect(status).toHaveClass("bg-[hsl(var(--success))]"),
        ),
    );
  });

  it("separates alternative credentials and saves only the selected method", async () => {
    gateway.provider.readCredentials.mockResolvedValue({
      ok: true,
      provider: "openai",
      fields: [
        {
          key: "GOOGLE_API_KEY",
          value: "google-secret",
          placeholder: "",
          kind: "secret",
          configured: true,
          origin: "saved",
        },
        {
          key: "GEMINI_API_KEY",
          value: "gemini-secret",
          placeholder: "",
          kind: "secret",
          configured: true,
          origin: "saved",
        },
        {
          key: "GEMINI_BASE_URL",
          value: "https://example.com/v1",
          placeholder: "https://example.com/v1",
          kind: "url",
        },
      ],
      auth_hint: "",
      auth_type: "api_key",
      connection: {
        status: "configured",
        active_method: "env:GOOGLE_API_KEY",
        active_scope: "profile",
        methods: [
          {
            id: "env:GOOGLE_API_KEY",
            kind: "api_key",
            source: "saved",
            field_key: "GOOGLE_API_KEY",
            configured: true,
            detected: true,
            editable: true,
            status: "active",
            scope: "profile",
          },
          {
            id: "env:GEMINI_API_KEY",
            kind: "api_key",
            source: "saved",
            field_key: "GEMINI_API_KEY",
            configured: true,
            detected: true,
            editable: true,
            status: "configured",
            scope: "profile",
          },
        ],
        service: { status: "not_checked", reason: "" },
      },
    });
    const user = userEvent.setup();
    render(<HermesModelConfigTab />);

    await user.click(
      await screen.findByRole("button", { name: /OpenAI/i, expanded: false }),
    );
    await user.click(screen.getByRole("button", { name: "Configure OpenAI" }));

    const dialog = await screen.findByRole("dialog", {
      name: "OpenAI",
    });
    const googleTab = within(dialog).getByRole("tab", {
      name: /Google API Key/,
    });
    const geminiTab = within(dialog).getByRole("tab", {
      name: /Gemini API Key/,
    });
    expect(googleTab).toHaveAttribute("data-credential-active", "true");
    const credentialInput = dialog.querySelector("#credential-GOOGLE_API_KEY");
    expect(credentialInput).toHaveAttribute("type", "password");
    expect(credentialInput).toHaveValue("google-secret");
    await user.click(
      within(dialog).getByRole("button", { name: "Show credential" }),
    );
    expect(credentialInput).toHaveAttribute("type", "text");
    expect(
      dialog.querySelector("#credential-GEMINI_BASE_URL"),
    ).toBeInTheDocument();
    const statusBadge = within(dialog).getByRole("button", {
      name: "This agent",
    });
    await user.click(statusBadge);
    expect(
      within(dialog).getByRole("dialog", { name: "Connection details" }),
    ).toHaveTextContent("Google API Key");
    expect(
      within(dialog).queryByText("Connection methods"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText(
        "Credentials and model availability are managed by Hermes.",
      ),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText(/first configured credential/),
    ).not.toBeInTheDocument();

    await user.click(geminiTab);
    await user.click(
      within(dialog).getByRole("button", { name: "Save credentials" }),
    );

    expect(gateway.provider.writeCredentials).toHaveBeenCalledWith(
      "openai",
      {
        GOOGLE_API_KEY: "",
        GEMINI_API_KEY: "gemini-secret",
        GEMINI_BASE_URL: "https://example.com/v1",
      },
      "default",
    );
  });

  it("opens a searchable model picker from the default route row", async () => {
    const user = userEvent.setup();
    render(<HermesModelConfigTab />);

    const defaultModelRow = await screen.findByRole("button", {
      name: /Default model/,
    });
    expect(
      defaultModelRow.querySelector("[data-model-slot-identity]"),
    ).toHaveClass("items-center");
    const slotLabel = defaultModelRow.querySelector("[data-model-slot-label]");
    expect(
      slotLabel?.querySelector("[data-model-primary-name]"),
    ).toHaveTextContent("GPT-5 mini");
    expect(slotLabel?.querySelector("[data-model-id]")).toHaveTextContent(
      "gpt-5-mini",
    );

    await user.click(defaultModelRow);

    const dialog = await screen.findByRole("dialog", {
      name: "Choose a model for Default model",
    });
    expect(dialog).toHaveAttribute("data-model-picker-modal", "true");
    expect(
      screen.getByPlaceholderText("Search models for Default model…"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", {
        name: /Let Hermes choose automatically/,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Choose" }),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByText("OpenRouter")).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("option", {
        name: /Claude Sonnet/,
      }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getAllByText("Multi-model collaboration"),
    ).not.toHaveLength(0);

    await user.click(
      within(dialog).getByRole("option", {
        name: /review/i,
      }),
    );
    expect(gateway.main.write).toHaveBeenCalledWith(
      {
        provider: "moa",
        model: "review",
        base_url: null,
      },
      "default",
    );
  });

  it("aligns the inherited auxiliary route with model items", async () => {
    const user = userEvent.setup();
    render(<HermesModelConfigTab />);

    await screen.findByText("Model assignments");
    await user.click(
      screen.getByRole("button", {
        name: /Auxiliary models/,
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: /Vision/,
      }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Choose a model for Vision",
    });
    expect(
      within(dialog).queryByText("Multi-model collaboration"),
    ).not.toBeInTheDocument();
    const inheritedOption = within(dialog).getByRole("option", {
      name: /Use the main model/,
    });
    expect(inheritedOption).toHaveTextContent(
      "Do not assign a separate model; always follow the current main model.",
    );
    const inheritedSummary = inheritedOption.querySelector(
      "[data-model-summary-option]",
    );
    const modelSummary = dialog.querySelector(
      '[data-model-summary="gpt-5-mini"]',
    );

    expect(inheritedSummary).toHaveClass(
      "grid",
      "grid-cols-[auto_minmax(0,1fr)_auto]",
      "gap-x-2",
    );
    expect(
      inheritedSummary?.querySelector("[data-model-summary-icon]"),
    ).toHaveClass("h-7", "w-7");
    expect(modelSummary).toHaveClass(
      "grid",
      "grid-cols-[auto_minmax(0,1fr)_auto]",
      "gap-x-2",
    );
    expect(
      modelSummary?.querySelector("[data-model-summary-icon]"),
    ).toHaveClass("h-7", "w-7");
  });
});
