import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ProviderSettingsController } from "../ModelProviderConfigTab.js";
import type {
  ModelPlaneSnapshotShape,
  ModelProviderProfileShape,
} from "../view-types.js";
import { ProviderOnboarding } from "../ProviderOnboarding.js";
vi.mock("../OfficialProviderEditor.js", () => ({
  OfficialProviderEditor: () => <div>Native credentials editor</div>,
}));
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
      credentialFields: [],
      removable: false,
    },
  });
  const data: ModelPlaneSnapshotShape = {
    revision: 1,
    providers: [provider("tokendance"), provider("deepseek")],
    groups: [],
    failures: [],
    credentials: {},
  };
  const adapter = {
    snapshot: vi.fn(async () => data),
    configure: vi.fn(async () => data),
    setDefaultSelection: vi.fn(async () => data),
  } as unknown as ProviderSettingsController;
  return {
    data,
    adapter,
    complete: vi.fn(async () => {}),
    say: vi.fn(),
    openSection: vi.fn(),
  };
}
describe("recommended provider onboarding", () => {
  it("recommends TokenDance and official DeepSeek, initializes a dormant profile before credential editing", async () => {
    const props = fixture();
    render(<ProviderOnboarding {...props} />);
    expect(
      screen.getByRole("button", { name: /TokenDance account/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/DSH official/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Use this model and continue" }),
    ).toBeDisabled();
    fireEvent.click(
      await screen.findByRole("button", { name: "Configure · TokenDance" }),
    );
    await screen.findByText("Native credentials editor");
    expect(props.adapter.configure).toHaveBeenCalledWith("tokendance", {
      expectedRevision: 4,
      ops: [{ op: "set", path: [], value: {} }],
      credentials: [],
    });
    expect(props.complete).not.toHaveBeenCalled();
  });
  it("saves the selected DeepSeek default before advancing and preserves errors for retry", async () => {
    const props = fixture(true);
    vi.mocked(props.adapter.setDefaultSelection).mockRejectedValueOnce(
      new Error("stale"),
    );
    render(<ProviderOnboarding {...props} />);
    await screen.findByRole("combobox");
    fireEvent.click(
      screen.getByRole("button", { name: /DeepSeek.*DSH official/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Use this model and continue" }),
    );
    await screen.findByRole("alert");
    expect(props.complete).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Use this model and continue" }),
    );
    await waitFor(() => expect(props.complete).toHaveBeenCalledOnce());
    expect(props.adapter.setDefaultSelection).toHaveBeenLastCalledWith(
      { provider: "deepseek", model: "deepseek-model" },
      1,
    );
  });
  it("keeps unavailable recommendations honest and offers existing settings for other providers", async () => {
    const props = fixture();
    props.data.providers = [];
    render(<ProviderOnboarding {...props} />);
    await screen.findByText(/This service is not available/);
    expect(
      screen.getByRole("button", { name: "Use this model and continue" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByText("Other services"));
    expect(props.openSection).toHaveBeenCalledWith("models");
  });
});
