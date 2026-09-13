import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import type { ProviderSettingsController } from "../ModelProviderConfigTab.js";
import type {
  ConfigureProviderInput,
  ModelPlaneSnapshotShape,
  ModelProviderProfileShape,
} from "../view-types.js";
import {
  ProviderOnboarding,
  PROVIDER_KEY_PAGES,
} from "../ProviderOnboarding.js";
afterEach(cleanup);
function fixture(ready = false) {
  const provider = (id: string): ModelProviderProfileShape => ({
    id,
    displayName: id === "tokendance" ? "TokenDance" : "DeepSeek",
    protocol: "provider-native",
    editable: true,
    enabled: ready,
    availability: ready ? "ready" : "unconfigured",
    source: "builtin",
    models: ready ? [{ id: `${id}-model`, name: `${id} model` }] : [],
    official: {
      provider: id,
      displayName: id,
      settingsNs: `llm-${id}`,
      settingsPath: id === "tokendance" ? ["providers", id] : [],
      active: ready,
    },
    configuration: {
      namespace: `llm-${id}`,
      path: ["providers", id],
      revision: 4,
      schema: {},
      value: {},
      credentialFields: ready
        ? [{ path: ["apiKeyEnv"], ref: `${id}_KEY` }]
        : [],
      removable: false,
    },
  });
  let data: ModelPlaneSnapshotShape = {
    revision: 1,
    providers: [provider("tokendance"), provider("deepseek")],
    groups: [],
    failures: [],
    credentials: ready
      ? {
          tokendance_KEY: { configured: true, writable: true },
          deepseek_KEY: { configured: true, writable: true },
        }
      : {},
  };
  const adapter = {
    snapshot: vi.fn(async () => data),
    configure: vi.fn(async (id: string, input: ConfigureProviderInput) => {
      const hasKey = input.credentials.some((edit) => !!edit.value);
      data = {
        ...data,
        providers: data.providers.map((p) =>
          p.id === id
            ? {
                ...p,
                official: { ...p.official!, active: true },
                configuration: {
                  ...p.configuration!,
                  revision: p.configuration!.revision + 1,
                  credentialFields: [{ path: ["apiKeyEnv"], ref: `${id}_KEY` }],
                },
                ...(hasKey
                  ? {
                      enabled: true,
                      availability: "ready",
                      models: [{ id: `${id}-model`, name: `${id} model` }],
                    }
                  : {}),
              }
            : p,
        ),
        credentials: hasKey
          ? {
              ...data.credentials,
              [`${id}_KEY`]: { configured: true, writable: true },
            }
          : data.credentials,
      };
      return data;
    }),
    setDefaultSelection: vi.fn(async () => data),
  } as unknown as ProviderSettingsController;
  return {
    adapter,
    complete: vi.fn(async () => {}),
    say: vi.fn(),
    openSection: vi.fn(),
    renderActions: (actions: ReactNode) => (
      <footer aria-label="Step actions">{actions}</footer>
    ),
    getData: () => data,
  };
}
async function openKey(props: ReturnType<typeof fixture>) {
  render(<ProviderOnboarding {...props} />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByLabelText("TokenDance API Key");
}
describe("provider setup pages", () => {
  it("keeps selection separate from configuration and navigates using the shared footer", async () => {
    const props = fixture();
    render(<ProviderOnboarding {...props} />);
    expect(
      screen.getByRole("button", { name: /TokenDance.*Amiba recommendation/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByLabelText("TokenDance API Key")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    const footer = screen.getByRole("contentinfo", { name: "Step actions" });
    await waitFor(() => expect(within(footer).getByText("Next")).toBeEnabled());
    fireEvent.click(within(footer).getByText("Next"));
    await screen.findByLabelText("TokenDance API Key");
    expect(props.adapter.configure).toHaveBeenCalledWith("tokendance", {
      expectedRevision: 4,
      ops: [{ op: "set", path: [], value: {} }],
      credentials: [],
    });
    expect(
      screen.getByRole("link", { name: /Open TokenDance/ }),
    ).toHaveAttribute("href", PROVIDER_KEY_PAGES.tokendance);
    expect(screen.getByText(/choose Create key/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save and continue" }),
    ).toBeDisabled();
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByText("Back"));
    expect(
      screen.getByRole("button", { name: /TokenDance.*Amiba recommendation/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });
  it("writes only the entered Key, clears it after save, and persists a default before completing", async () => {
    const props = fixture();
    await openKey(props);
    const input = screen.getByLabelText("TokenDance API Key");
    expect(input).toHaveAttribute("type", "password");
    fireEvent.change(input, { target: { value: "  test-key  " } });
    fireEvent.submit(input.closest("form")!);
    await screen.findByRole("combobox");
    expect(props.adapter.configure).toHaveBeenLastCalledWith("tokendance", {
      expectedRevision: 5,
      ops: [],
      credentials: [{ ref: "tokendance_KEY", value: "test-key" }],
    });
    expect(props.complete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Back"));
    expect(await screen.findByLabelText("TokenDance API Key")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("combobox");
    fireEvent.click(screen.getByText("Finish setup"));
    await waitFor(() => expect(props.complete).toHaveBeenCalledOnce());
    expect(props.adapter.setDefaultSelection).toHaveBeenCalledWith(
      { provider: "tokendance", model: "tokendance-model" },
      1,
    );
  });
  it("shows DeepSeek key instructions, reuses a stored Key, and retries default-save failures", async () => {
    const props = fixture(true);
    render(<ProviderOnboarding {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: /DeepSeek.*DSH official/ }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Next" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByLabelText("DeepSeek API Key");
    expect(screen.getByRole("link", { name: /Open DeepSeek/ })).toHaveAttribute(
      "href",
      PROVIDER_KEY_PAGES.deepseek,
    );
    expect(screen.getByText(/create a new API key/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("combobox");
    expect(props.adapter.configure).not.toHaveBeenCalled();
    vi.mocked(props.adapter.setDefaultSelection).mockRejectedValueOnce(
      new Error("conflict"),
    );
    fireEvent.click(screen.getByText("Finish setup"));
    await screen.findByRole("alert");
    expect(props.complete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Finish setup"));
    await waitFor(() => expect(props.complete).toHaveBeenCalledOnce());
  });
  it("keeps a failed key save on the key page for retry", async () => {
    const props = fixture();
    await openKey(props);
    vi.mocked(props.adapter.configure!).mockRejectedValueOnce(
      new Error("write failed"),
    );
    fireEvent.change(screen.getByLabelText("TokenDance API Key"), {
      target: { value: "test-retry" },
    });
    fireEvent.click(screen.getByText("Save and continue"));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("TokenDance API Key")).toHaveValue(
      "test-retry",
    );
    expect(props.complete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Save and continue"));
    await screen.findByRole("combobox");
  });
  it("clears unsaved keys when changing provider", async () => {
    const props = fixture();
    await openKey(props);
    fireEvent.change(screen.getByLabelText("TokenDance API Key"), {
      target: { value: "do-not-share" },
    });
    fireEvent.click(screen.getByText("Back"));
    fireEvent.click(
      screen.getByRole("button", { name: /DeepSeek.*DSH official/ }),
    );
    fireEvent.click(screen.getByText("Next"));
    expect(await screen.findByLabelText("DeepSeek API Key")).toHaveValue("");
    expect(screen.getByText("Save and continue")).toBeDisabled();
  });
  it("does not let an existing Key bypass missing models", async () => {
    const props = fixture(true);
    props.getData().providers[0].models = [];
    await openKey(props);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText(/No available models yet/);
    expect(screen.getByText("Finish setup")).toBeDisabled();
    expect(props.complete).not.toHaveBeenCalled();
  });
});
