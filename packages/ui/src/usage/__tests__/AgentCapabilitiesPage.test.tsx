import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  getHermesComputerUseStatus: vi.fn(),
  getHermesInstalledMcps: vi.fn(),
  readHermesModelPicker: vi.fn(),
  readHermesModelWorkspace: vi.fn(),
  writeHermesAuxiliaryModel: vi.fn(),
  getHermesPlugins: vi.fn(),
  getHermesTerminalBackends: vi.fn(),
  getHermesToolsetDetail: vi.fn(),
  getHermesToolsetModels: vi.fn(),
  getHermesToolsets: vi.fn(),
  postHermesComputerUseGrant: vi.fn(),
  postHermesToolsetSetup: vi.fn(),
  putHermesTerminalBackend: vi.fn(),
  putHermesTerminalEnv: vi.fn(),
  putHermesToolsetEnv: vi.fn(),
  putHermesToolsetModel: vi.fn(),
  putHermesToolsetProvider: vi.fn(),
  putHermesToolsetToggle: vi.fn(),
  setPluginEnabled: vi.fn(),
}));

vi.mock("@amiba/core", () => ({
  ...core,
  hermesModelGateway: {
    workspace: { read: core.readHermesModelWorkspace },
    picker: { read: core.readHermesModelPicker },
    auxiliary: { write: core.writeHermesAuxiliaryModel },
  },
}));
vi.mock("../ToolsActivityTab", () => ({
  ToolsActivityTab: () => <div>Capability usage diagnostics</div>,
}));

import { AgentCapabilitiesPage } from "../AgentCapabilitiesPage";

const webToolset = {
  name: "web",
  label: "Web Search & Scraping",
  description: "web_search, web_extract",
  enabled: true,
  available: true,
  configured: false,
  tools: ["web_search", "web_extract"],
};

const webDetail = {
  ...webToolset,
  items: [{ name: "web_search", description: "Search the web.", emoji: "🌐" }],
  has_category: true,
  active_search_backend: "firecrawl",
  active_extract_backend: "firecrawl",
  providers: [
    {
      name: "Firecrawl",
      badge: "recommended",
      tag: "Search and extraction",
      env_vars: [
        {
          key: "FIRECRAWL_API_KEY",
          prompt: "Firecrawl API key",
          is_set: false,
          secret: true,
        },
      ],
      requires_nous_auth: false,
      is_active: true,
      status: "needs_key",
      web_backend: "firecrawl",
      capabilities: ["search", "extract"],
    },
  ],
};

describe("AgentCapabilitiesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    core.getHermesToolsets.mockResolvedValue({
      ok: true,
      toolsets: [
        webToolset,
        {
          name: "browser",
          label: "Browser Automation",
          description: "navigate, click, type, scroll",
          enabled: true,
          available: true,
          configured: false,
          tools: ["browser_navigate", "browser_snapshot"],
        },
        {
          name: "vision",
          label: "Vision / Image Analysis",
          description: "vision_analyze",
          enabled: true,
          available: true,
          configured: true,
          tools: ["vision_analyze"],
        },
        {
          name: "video",
          label: "Video Analysis",
          description: "video_analyze",
          enabled: false,
          available: false,
          configured: false,
          tools: ["video_analyze"],
        },
        {
          name: "file",
          label: "File Operations",
          description: "read, write, patch, search",
          enabled: true,
          available: true,
          configured: true,
          tools: ["read_file", "write_file"],
        },
        {
          name: "terminal",
          label: "Terminal & Processes",
          description: "terminal, process",
          enabled: true,
          available: true,
          configured: true,
          tools: ["terminal", "process"],
        },
        {
          name: "skills",
          label: "Skills",
          description: "list, view, manage",
          enabled: true,
          available: true,
          configured: true,
          tools: ["skills_list"],
        },
      ],
    });
    core.getHermesToolsetDetail.mockResolvedValue({
      ok: true,
      toolset: webDetail,
    });
    core.getHermesInstalledMcps.mockResolvedValue({
      ok: true,
      items: [
        {
          slug: "filesystem",
          label: "Filesystem",
          description: "Access selected local folders.",
          source: "curated",
          installed: true,
          enabled: true,
          transport_kind: "stdio",
        },
      ],
    });
    core.getHermesPlugins.mockResolvedValue({ ok: true, plugins: [] });
    core.readHermesModelWorkspace.mockResolvedValue({
      main: {
        ok: true,
        provider: "xiaomi",
        model: "mimo-v2.5",
        capabilities: { supports_vision: false },
      },
      auxiliary: {
        ok: true,
        tasks: [{ task: "vision", provider: "", model: "", base_url: "" }],
        main: { provider: "xiaomi", model: "mimo-v2.5" },
      },
      catalog: {
        ok: true,
        providers: {
          xiaomi: {
            models: [{ id: "mimo-v2.5", description: "MiMo V2.5" }],
          },
          openrouter: {
            models: [
              {
                id: "google/gemini-2.5-flash",
                description: "Gemini 2.5 Flash",
              },
            ],
          },
        },
        canonical_providers: [
          { slug: "xiaomi", label: "Xiaomi", tui_desc: "Xiaomi" },
          {
            slug: "openrouter",
            label: "OpenRouter",
            tui_desc: "OpenRouter",
          },
        ],
      },
      displayPreferences: {
        version: 1,
        providerOverrides: {},
        hiddenModels: {},
      },
      providers: [],
    });
    core.readHermesModelPicker.mockResolvedValue({
      ok: true,
      current: { provider: "xiaomi", model: "mimo-v2.5" },
      groups: [
        {
          provider: "xiaomi",
          label: "Xiaomi",
          models: [{ id: "mimo-v2.5", description: "MiMo V2.5" }],
        },
        {
          provider: "openrouter",
          label: "OpenRouter",
          models: [
            {
              id: "google/gemini-2.5-flash",
              description: "Gemini 2.5 Flash",
            },
          ],
        },
      ],
      capabilities: [],
    });
    core.writeHermesAuxiliaryModel.mockResolvedValue({
      ok: true,
      tasks: [
        {
          task: "vision",
          provider: "openrouter",
          model: "google/gemini-2.5-flash",
          base_url: "",
        },
      ],
    });
  });

  it("shows curated abilities while hiding the internal tool registry", async () => {
    const user = userEvent.setup();
    const { container } = render(<AgentCapabilitiesPage />);

    expect(await screen.findByText("Built-in tools")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Tools" }),
    ).not.toBeInTheDocument();
    expect(
      container.querySelectorAll("[data-tool-settings-surface]"),
    ).toHaveLength(1);
    expect(container.querySelectorAll("[data-tool-group]")).toHaveLength(3);
    expect(screen.getByText("Understand content")).toBeInTheDocument();
    expect(screen.getByText("Find and use information")).toBeInTheDocument();
    expect(screen.getByText("Work on this device")).toBeInTheDocument();
    expect(screen.getByText("Understand images")).toBeInTheDocument();
    expect(screen.getByText("Search and read the web")).toBeInTheDocument();
    expect(screen.getByText("Run code and commands")).toBeInTheDocument();
    expect(screen.queryByText("Work with files")).not.toBeInTheDocument();
    expect(screen.queryByText("Execute code")).not.toBeInTheDocument();

    expect(screen.getByText("External tools")).toBeInTheDocument();
    expect(await screen.findByText("Filesystem")).toBeInTheDocument();
    expect(screen.queryByText("Web Search & Scraping")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Vision / Image Analysis"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Skills")).not.toBeInTheDocument();
    expect(screen.queryByText("web_search")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Search and read the web/ }),
    );

    expect(await screen.findByText("Choose how it works")).toBeInTheDocument();
    expect(
      screen.queryByText("Finish setting this up"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("switch", {
        name: "Allow this assistant to use this tool",
      }),
    ).toBeChecked();
    expect(screen.getByLabelText("Firecrawl API key")).toBeInTheDocument();
    expect(screen.queryByText("FIRECRAWL_API_KEY")).not.toBeInTheDocument();
  });

  it("provides model-source configuration for image and video understanding", async () => {
    const user = userEvent.setup();
    core.getHermesToolsetDetail.mockImplementation(async (name: string) => {
      const enabled = name === "vision";
      return {
        ok: true,
        toolset: {
          name,
          label: name,
          description: "",
          enabled,
          available: enabled,
          configured: false,
          tools: [`${name}_analyze`],
          items: [],
          providers: [],
          has_category: false,
        },
      };
    });

    render(<AgentCapabilitiesPage />);

    await user.click(
      await screen.findByRole("button", { name: /Understand images/ }),
    );
    expect(await screen.findByText("Current model source")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The main model does not support image input. Choose a dedicated model below.",
      ),
    ).toBeInTheDocument();
    const modelField = screen.getByRole("button", {
      name: "Use the main model",
    });
    expect(modelField).toBeInTheDocument();
    expect(screen.getByText("MiMo V2.5")).toBeInTheDocument();

    await user.click(modelField);
    expect(await screen.findByTestId("model-picker-input")).toBeInTheDocument();
    await user.click(screen.getByText("Gemini 2.5 Flash"));
    expect(core.readHermesModelPicker).toHaveBeenCalledWith(undefined);
    expect(core.writeHermesAuxiliaryModel).toHaveBeenCalledWith(
      {
        task: "vision",
        provider: "openrouter",
        model: "google/gemini-2.5-flash",
      },
      undefined,
    );

    await user.click(screen.getByRole("button", { name: "Back to tools" }));
    await user.click(screen.getByRole("button", { name: /Understand video/ }));
    expect(
      await screen.findByRole("button", {
        name: "Use the main model",
      }),
    ).toBeInTheDocument();
  });

  it("uses the selected profile without repeating page chrome when embedded", async () => {
    const user = userEvent.setup();
    render(<AgentCapabilitiesPage embedded profileId="researcher" />);

    expect(await screen.findByText("Find and use information")).toBeVisible();
    expect(core.getHermesToolsets).toHaveBeenCalledWith("researcher");
    expect(
      screen.queryByRole("heading", { name: "Tools" }),
    ).not.toBeInTheDocument();
    expect(core.getHermesInstalledMcps).toHaveBeenCalledWith("researcher");

    await user.click(
      screen.getByRole("button", { name: /Search and read the web/ }),
    );

    expect(core.getHermesToolsetDetail).toHaveBeenCalledWith(
      "web",
      "researcher",
    );
  });

  it("explains provider setup work without adding inline instructions", async () => {
    const user = userEvent.setup();
    core.getHermesToolsetDetail.mockResolvedValue({
      ok: true,
      toolset: {
        name: "browser",
        label: "Browser Automation",
        description: "navigate, click, type, scroll",
        enabled: true,
        available: true,
        configured: false,
        tools: ["browser_navigate", "browser_snapshot"],
        items: [],
        providers: [
          {
            name: "Local Browser",
            badge: "recommended",
            tag: "Headless Chromium, no API key needed",
            env_vars: [],
            post_setup: "agent_browser",
            requires_nous_auth: false,
            is_active: true,
            status: "needs_setup",
            browser_provider: "local",
          },
        ],
        has_category: true,
        active_provider: "Local Browser",
      },
    });

    render(<AgentCapabilitiesPage />);

    await user.click(
      await screen.findByRole("button", { name: /Operate web pages/ }),
    );

    expect(await screen.findByText("Local browser components")).toBeVisible();
    expect(
      screen.queryByText(/matching Playwright Chromium/),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "View setup details for Local browser components",
      }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/matching Playwright Chromium/),
    ).toBeVisible();
    expect(
      within(dialog).getByText(/do not read your everyday Chrome accounts/),
    ).toBeVisible();
  });
});
