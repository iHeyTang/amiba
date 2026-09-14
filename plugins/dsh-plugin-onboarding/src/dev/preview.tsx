// Isolated visual fixture: no DSH profile, real credentials, or network model calls.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { setPlatform, type PlatformAdapter } from "@amiba/app-runtime/platform";
import { installMessageCatalog } from "@amiba/i18n";
import { en, zhCN } from "@amiba/ui/locales";
import { Guide, type GuideProps } from "../client/Guide";
import { ProviderOnboarding } from "../../../dsh-plugin-model-plane/src/client/ProviderOnboarding";
import { PetView } from "../../../dsh-plugin-pets/src/client/PetView";
import { grovePack, makeConfig } from "../../../dsh-plugin-pets/src/model";
import type { GuideMood, GuideStepOwner } from "../client/contracts";
import type { ProviderSettingsController } from "../../../dsh-plugin-model-plane/src/client/ModelProviderConfigTab";
import type {
  ConfigureProviderInput,
  ModelPlaneSnapshotShape,
} from "../../../dsh-plugin-model-plane/src/client/view-types";
import "../../../dsh-plugin-ui-shell/src/dev/surfaces.css";
setPlatform({
  storage: {
    get: async () => ({ language: "zh-CN" }),
    set: async () => {},
    remove: async () => {},
    watch: () => () => {},
  },
} as unknown as PlatformAdapter);
installMessageCatalog({ en, "zh-CN": zhCN });
let progress = { completed: [] as string[], finished: false };
const store = {
  read: async () => progress,
  mark: async (id: string) =>
    (progress = { ...progress, completed: [...progress.completed, id] }),
  finish: async () => (progress = { ...progress, finished: true }),
};
const rows = [{ id: "models", label: "模型服务" }];
const steps = { getSnapshot: () => rows, subscribe: () => () => {} };
const schema = {
  type: "object",
  dict: { apiKeyEnv: { type: "string", meta: { role: "credential-ref" } } },
};
let snapshot: ModelPlaneSnapshotShape = {
  revision: 1,
  groups: [],
  failures: [],
  credentials: {},
  providers: ["tokendance", "deepseek"].map((id) => ({
    id,
    displayName: id === "tokendance" ? "TokenDance" : "DeepSeek",
    protocol: "provider-native",
    enabled: false,
    editable: true,
    availability: "missing-credential",
    source: "builtin",
    models: [],
    official: {
      provider: id,
      displayName: id,
      settingsNs: `llm-${id}`,
      settingsPath: [],
      active: true,
    },
    configuration: {
      namespace: `llm-${id}`,
      path: [],
      revision: 1,
      schema,
      value: { apiKeyEnv: `${id.toUpperCase()}_API_KEY` },
      credentialFields: [
        { path: ["apiKeyEnv"], ref: `${id.toUpperCase()}_API_KEY` },
      ],
      removable: false,
    },
  })),
};
const adapter = {
  snapshot: async () => snapshot,
  configure: async (id: string, input: ConfigureProviderInput) => {
    if (input.credentials.some((edit) => edit.value?.trim())) {
      snapshot = {
        ...snapshot,
        credentials: {
          ...snapshot.credentials,
          [`${id.toUpperCase()}_API_KEY`]: { configured: true, writable: true },
        },
      };
    }
    snapshot = {
      ...snapshot,
      providers: snapshot.providers.map((p) =>
        p.id === id
          ? {
              ...p,
              enabled: true,
              availability: "ready",
              models: [{ id: "demo-model", name: "演示模型（仅界面预览）" }],
            }
          : p,
      ),
    };
    return snapshot;
  },
  setDefaultSelection: async (selection: any) =>
    (snapshot = { ...snapshot, defaultSelection: selection }),
} as unknown as ProviderSettingsController;
const config = makeConfig({ name: "Mofli", skinId: grovePack.skins[0].id });
const renderSlot: GuideProps["renderSlot"] = ((
  name: string,
  props: GuideStepOwner & { mood: GuideMood; reactionId?: number },
) =>
  name === "amiba.onboarding.companion" ? (
    <PetView
      config={config}
      name="Mofli"
      key={props.reactionId}
      previewScene={props.mood}
      className="h-28 w-28"
    />
  ) : (
    <ProviderOnboarding {...props} adapter={adapter} />
  )) as GuideProps["renderSlot"];
function Preview() {
  const [open, setOpen] = useState(true);
  return (
    <main className="min-h-screen bg-background p-12 text-foreground">
      <p className="text-sm text-muted-foreground">
        Amiba · 独立引导预览 · 不会修改真实配置
      </p>
      <button
        className="mt-6 rounded-md border px-4 py-2"
        onClick={() => {
          progress = { completed: [], finished: false };
          setOpen(true);
        }}
      >
        重新预览
      </button>
      {open && (
        <Guide
          store={store}
          steps={steps}
          close={() => setOpen(false)}
          openSection={() => setOpen(false)}
          renderSlot={renderSlot}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
