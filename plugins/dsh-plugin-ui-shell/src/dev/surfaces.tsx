import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as JSXRuntime from "react/jsx-runtime";
import * as Slots from "@deepseek-ai/dsh-client-ui-slots";
import { setPlatform, type PlatformAdapter } from "@amiba/app-runtime/platform";
import { installMessageCatalog } from "@amiba/i18n";
import { en, zhCN } from "@amiba/ui/locales";
import { Composer } from "../../../../packages/ui/src/chat/Composer";
import { MessageTurns } from "../../../../packages/ui/src/chat/bubble/Bubble";
import { EmptyStateVisual } from "../../../../packages/ui/src/primitives/empty-state-visual";
import {
  InteractionRegion,
  PresentationRoot,
} from "../../../../packages/ui/src/primitives/interaction-region";
import { createSurfaceActivity } from "../../../../packages/ui/src/primitives/surface-activity";
import { SurfaceProvider } from "../client/surface-provider";
import { SurfaceSettings } from "../client/surface-settings";
import { createSurfaceSelections } from "../client/surface-selections";
import { apply } from "./surface-probe";
// Use the shipped DSH renderer, not a test reimplementation of renderSlot.
// @ts-ignore Vite raw module
import rendererSource from "../../../../packages/app-runtime/resources/dsh-runtime/app/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js?raw";
import "./surfaces.css";

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
let unload: () => void = () => {};
const pluginContext = {
  slots: {
    register: core.register.bind(core),
    inject: (_name: string, fn: () => () => void) => fn(),
  },
} as Parameters<typeof apply>[0];
function App({
  renderSlot,
}: Slots.PropsRenderSlots<
  | "amiba.emptyState.visual"
  | "amiba.message.decoration"
  | "shell.overlay"
>) {
  const [session, setSession] = React.useState("a"),
    [text, setText] = React.useState(""),
    [menu, setMenu] = React.useState(false),
    [loaded, setLoaded] = React.useState(false);
  const activity = React.useMemo(
    () => createSurfaceActivity(session),
    [session],
  );
  (window as any).surfaceHarness = {
    event: (e: any) => activity.event(session, e),
    snapshot: (frame: any) => activity.snapshot(frame),
    select: (slot: any, id: string) => surfaces.set(slot, id),
    session,
  };
  return (
    <PresentationRoot>
      <SurfaceProvider surfaces={surfaces} renderSlot={renderSlot as any}>
        <header>
          <button
            onClick={() => {
              if (loaded) unload();
              else unload = apply(pluginContext);
              setLoaded(!loaded);
            }}
          >
            {loaded ? "Unload probe" : "Load probe"}
          </button>
          <button onClick={() => setSession(session === "a" ? "b" : "a")}>
            Switch session
          </button>
          <button onClick={() => setMenu(!menu)}>Toggle menu</button>
        </header>
        <SurfaceSettings surfaces={surfaces} />
        <InteractionRegion
          activity={activity.activity}
          data-testid="surface"
          className="surface"
        >
          <EmptyStateVisual scene="home">
            <span data-default="">Default welcome</span>
          </EmptyStateVisual>
          <Composer
            value={text}
            onChange={setText}
            onSubmit={() =>
              activity.event(session, { kind: "begin", assistantUiId: "run" })
            }
            inputOverlay={
              menu ? (
                <div data-menu="" className="menu">
                  Menu above composer
                </div>
              ) : null
            }
          />
          <MessageTurns
            sessionId={session}
            messages={[
              {
                role: "assistant",
                uiId: "message-" + session,
                content: "A real message rendered by Amiba.",
                streaming: false,
              },
            ]}
          />
        </InteractionRegion>
        {renderSlot("shell.overlay", {})}
      </SurfaceProvider>
    </PresentationRoot>
  );
}
core.register(
  {
    name: "root",
    children: {
      "amiba.emptyState.visual": { kind: "list", scope: "root" },
      "amiba.message.decoration": { kind: "list", scope: "root" },
      "shell.overlay": { kind: "list", scope: "root" },
    },
  },
  App,
);
ReactDOMClient.createRoot(document.getElementById("root")!).render(
  renderer!.renderRoot(host, {}),
);
