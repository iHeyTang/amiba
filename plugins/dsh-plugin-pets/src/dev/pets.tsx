import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as JSXRuntime from "react/jsx-runtime";
import * as Cordis from "@deepseek-ai/cordis";
import { PET_REMOTE } from "../remote";
import * as Slots from "@deepseek-ai/dsh-client-ui-slots";
import { setPlatform, type PlatformAdapter } from "@amiba/app-runtime/platform";
import { installMessageCatalog } from "../../../../packages/i18n/src/index";
import { en, zhCN } from "@amiba/ui/locales";
import { Composer } from "../../../../packages/ui/src/chat/Composer";
import { MessageTurns } from "../../../../packages/ui/src/chat/bubble/Bubble";
import { EmptyStateVisual } from "../../../../packages/ui/src/primitives/empty-state-visual";
import {
  InteractionRegion,
  PresentationRoot,
} from "../../../../packages/ui/src/primitives/interaction-region";
import { createSurfaceActivity } from "../../../../packages/ui/src/primitives/surface-activity";
import { SurfaceProvider } from "../../../dsh-plugin-ui-shell/src/client/surface-provider";
import { SurfaceSettings } from "../../../dsh-plugin-ui-shell/src/client/surface-settings";
import { createSurfaceSelections } from "../../../dsh-plugin-ui-shell/src/client/surface-selections";
import { apply } from "../client/index";
// Use the shipped DSH renderer, not a test reimplementation of renderSlot.
// @ts-ignore Vite raw module
import rendererSource from "../../../../packages/app-runtime/resources/dsh-runtime/app/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js?raw";
// @ts-ignore Vite raw module
import gatewaySource from "../../../../packages/app-runtime/resources/dsh-runtime/app/node_modules/@deepseek-ai/dsh-api-gateway/lib/client.js?raw";
// @ts-ignore Vite raw module
import registrySource from "../../../../packages/app-runtime/resources/dsh-runtime/app/node_modules/@deepseek-ai/dsh-typert-registry/lib/client.js?raw";
import "../../../dsh-plugin-ui-shell/src/dev/surfaces.css";

const storage = {
  get: async (keys: string[]) =>
    Object.fromEntries(
      keys.map((key) => [key, JSON.parse(localStorage.getItem(key) || "null")]),
    ),
  set: async (values: Record<string, unknown>) => {
    Object.entries(values).forEach(([key, value]) =>
      localStorage.setItem(key, JSON.stringify(value)),
    );
  },
  remove: async () => {},
  watch: () => () => {},
};
setPlatform({ storage } as unknown as PlatformAdapter);
installMessageCatalog({ en, "zh-CN": zhCN });
const core = new Slots.SlotCore();
const surfaces = createSurfaceSelections(core, storage);
const modules: Record<string, unknown> = {
  react: React,
  "react-dom": ReactDOM,
  "react-dom/client": ReactDOMClient,
  "react/jsx-runtime": JSXRuntime,
  "@deepseek-ai/dsh-client-ui-slots": Slots,
};
let renderer: Slots.SlotRenderer;
new Function("window", rendererSource)({
  __ModuleLoader__: {
    load: ({ factory }: any) => {
      factory((id: string) => {
        if (!(id in modules))
          throw new Error(`Unknown renderer dependency: ${id}`);
        return modules[id];
      }).apply({
        slots: {
          install: (r: Slots.SlotRenderer) => {
            renderer = r;
          },
        },
        reflect: { provide: () => {} },
      });
    },
  },
});
const source = (value: unknown) => ({
  getSnapshot: () => value,
  subscribe: () => () => {},
});
const host: Slots.SlotRendererHost = {
  subscribe: core.subscribe.bind(core),
  getVersion: core.getVersion.bind(core),
  entriesOfSlot: core.entriesOfSlot.bind(core),
  entriesOf: core.entries.bind(core),
  reportEntryError: (...args) => {
    console.error(args[2]);
    core.reportEntryError(...args);
  },
  specOf: core.specDynamic.bind(core),
  isLive: core.isLive.bind(core),
  storeOf: () => undefined,
  sessions: {
    list: source({}),
    provideInfo: source({ sessionId: undefined, hooks: {}, props: {} }) as any,
  },
  workspaces: { list: source({}) },
};

const gatewayContext = new Cordis.Context();
gatewayContext.provide("connection", {
  rpc: {
    call: async (_path: string, endpoint: string, { args }: any) => {
      const method = endpoint.split("/")[1];
      const descriptor = PET_REMOTE.descriptors.find((d) => d.method === method)!;
      return fetch("/__pets/" + method, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(descriptor.parameters.map((p) => args[p.wire])),
      }).then((r) => r.json());
    },
  },
} as any);
for (const source of [registrySource, gatewaySource]) {
  new Function("window", source)({ __ModuleLoader__: {
    load: ({ factory }: any) => factory((id: string) => {
      if (id === "@deepseek-ai/cordis") return Cordis;
      throw new Error(`Unknown gateway dependency: ${id}`);
    }).apply(gatewayContext),
  } });
}
const pluginContext: any = {
  slots: {
    register: core.register.bind(core),
    inject: (_name: string, fn: () => () => void) => fn(),
  },
  remote: (gatewayContext as any).remote,
  layout: {
    openNewChat: (prompt: string) => {
      (window as any).agentPrompt = prompt;
    },
  },
  inject: (_deps: unknown, fn: (ctx: unknown) => () => void) => {
    const off = fn(pluginContext);
    const p = Promise.resolve() as any;
    p.dispose = off;
    return p;
  },
};
function App({
  renderSlot,
}: Slots.PropsRenderSlots<
  | "amiba.workspace.view"
  | "amiba.emptyState.visual"
  | "amiba.composer.accessory"
  | "amiba.message.decoration"
>) {
  const [surface, setSurface] = React.useState(false);
  const [conversation, setConversation] = React.useState(false);
  React.useEffect(() => {
    let dispose: (() => unknown) | undefined;
    void apply(pluginContext).then((off) => {
      dispose = off;
    });
    return () => {
      dispose?.();
    };
  }, []);
  (window as any).petsHarness = { select: surfaces.set, getSurfaces: surfaces.getSnapshot, remote: (gatewayContext as any).remote.amibaPets };
  return (
    <PresentationRoot>
      <SurfaceProvider surfaces={surfaces} renderSlot={renderSlot as any}>
        <button data-switch onClick={() => setSurface(!surface)}>
          Toggle companion test
        </button>
        {surface ? (
          <>
            <SurfaceSettings surfaces={surfaces} />
            <InteractionRegion className="surface">
              <button data-conversation onClick={() => setConversation(!conversation)}>Toggle conversation</button>
              {conversation ? <div style={{ padding: "48px 0" }}>Conversation reply</div> : <EmptyStateVisual scene="home">Default</EmptyStateVisual>}
              <div data-composer-dock="" style={{ paddingTop: "calc(8px + var(--amiba-companion-clearance, 0px))" }}><Composer value="" onChange={() => {}} onSubmit={() => {}} /></div>
            </InteractionRegion>
          </>
        ) : (
          <div style={{ height: "calc(100vh - 80px)" }}>
            {renderSlot("amiba.workspace.view", {}, { only: "pets" })}
          </div>
        )}
      </SurfaceProvider>
    </PresentationRoot>
  );
}
core.register(
  {
    name: "root",
    children: {
      "amiba.workspace.navigation": { kind: "list", scope: "root" },
      "amiba.workspace.view": { kind: "list", scope: "root" },
      "amiba.emptyState.visual": { kind: "list", scope: "root" },
      "amiba.composer.accessory": { kind: "list", scope: "root" },
      "amiba.message.decoration": { kind: "list", scope: "root" },
    },
  },
  App,
);
ReactDOMClient.createRoot(document.getElementById("root")!).render(
  renderer!.renderRoot(host, {}),
);
