import { DesktopSyncHeader } from "./DesktopSyncSettings.js";
import { createConnectorMessageSource } from "./message-source.js";
import { createExternalSessionGroup } from "./session-group.js";
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type { PropsRuntime, PropsRenderSlots } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import { Cable } from "lucide-react";
import type { ReactNode } from "react";

import { buildConnectAdapter, type ConnectAdapter } from "./adapter.js";
import { ConnectAddToolview } from "./ConnectAddToolview.js";
import { ConnectQuestionScreen } from "./ConnectQuestionScreen.js";
import { DshSettingsConnect } from "./DshSettingsConnect.js";
import { loadAgentPresets, type PresetConnection } from "./presets.js";
import {
  createConnectorUIRegistry,
  type ConnectorUIRegistry,
  type PresetOption,
} from "./connector-ui-registry.js";
import {
  CONNECT_ADD_TOOL_NAME,
  CONNECT_WIZARD_QUESTION_ID,
} from "../connect-wizard-question.js";
import { AMIBA_CONNECTORS_REMOTE } from "../remote.js";

export const name = "amiba-connector-ui";
export const inject = ["slots", "remote"];

const SECTION_ID = "connect";

/**
 * Client-side registry of provider wizards, provided as the
 * `amibaConnectorUI` Cordis service — mirrors ui-shell's `layout` service
 * augmentation exactly (`plugins/dsh-plugin-ui-shell/src/client/index.tsx`),
 * including using `ctx.reflect.provide` so plugins declaring `inject:
 * ["amibaConnectorUI"]` can register a provider wizard from their own
 * client half (Phase B).
 */
declare module "@deepseek-ai/cordis" {
  interface Context {
    amibaConnectorUI: ConnectorUIRegistry;
  }
}

/**
 * The wizard contract, re-exported through this package's `./client` entry so
 * a provider plugin's own client half can type its wizard body against it
 * (`import type { ConnectWizardHost } from
 * "@amiba/dsh-plugin-connector-core/client"`). Type-only on purpose: nothing
 * of it survives into a provider's bundle, and a provider body still depends
 * on no runtime value from this package — only on the `host` prop it is
 * handed.
 */
export type {
  ConnectWizardHost,
  ConnectorUIContribution,
  ConnectorUIRegistry,
  ConnectSettingsHost,
  PresetOption,
} from "./connector-ui-registry.js";
export type { ConnectWizardKit, BasicsFieldsProps } from "./wizard-kit.js";

type ConnectSectionProps = PropsRuntime<"settings.section"> & PropsRenderSlots<"amiba.connection.access"> & {
  adapter: ConnectAdapter;
  registry: ConnectorUIRegistry;
  loadPresets: () => Promise<PresetOption[]>;
};

/**
 * Thin registration wrapper. `PropsRuntime<"settings.section">` carries
 * framework-mandatory members (`close`, `useSessions`, `useWorkspaces`) that
 * only the real slot runtime supplies; Connect needs none of them, so this
 * wrapper exists only to satisfy `slots.register`'s prop contract and forward
 * the props `DshSettingsConnect` actually needs. The page stays plainly
 * typed so it can be rendered directly in a unit test.
 */
function ConnectSettingsSection({
  adapter,
  registry,
  loadPresets,
  renderSlot,
}: ConnectSectionProps): ReactNode {
  return (
    <DshSettingsConnect
      adapter={adapter}
      loadPresets={loadPresets}
      registry={registry}
      renderAccess={recordId => renderSlot("amiba.connection.access", { configuration: { ownerId: "connector-core", recordId } })}
    />
  );
}

/** Register connector-core's management surface from the plugin's Client half. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(AMIBA_CONNECTORS_REMOTE);
  // Provided BEFORE the settings.section registration below so a provider
  // plugin's own client half — which will inject `["amibaConnectorUI"]`
  // to register its wizard (Phase B) — can never race the section that
  // reads from this same registry.
  const registry = createConnectorUIRegistry();
  const disposeRegistry = ctx.reflect.provide("amibaConnectorUI", registry);
  const sectionFiber = ctx.inject(
    ["slots", "remote.amibaConnectors"],
    (injectedCtx) => {
      const messageSource = createConnectorMessageSource(async () => {
        const result = await injectedCtx.remote.amibaConnectors.messageSources();
        if (!result.ok) throw new Error(result.error.message);
        return result.value;
      });
      const disposeMessageSource = injectedCtx.slots.inject("amiba.message.source", () =>
        injectedCtx.slots.register({
          name: "amiba.message.source", id: "connector-messages", order: 150,
          label: () => document.documentElement.lang.toLowerCase().startsWith("zh") ? "外部消息" : "External messages",
          inject: () => messageSource.face,
        }, () => null),
      );
      const group = createExternalSessionGroup(async ids => {
        const result = await injectedCtx.remote.amibaConnectors.externalSessions(ids);
        if (!result.ok) throw new Error(result.error.message);
        return result.value;
      });
      const disposeGroup = injectedCtx.slots.inject("amiba.sessions.list.group", () =>
        injectedCtx.slots.register({
          name: "amiba.sessions.list.group",
          id: "external-messages",
          order: 150,
          label: () => document.documentElement.lang.toLowerCase().startsWith("zh") ? "外部消息" : "External messages",
          inject: () => group.face,
        }, () => null),
      );
      const adapter = buildConnectAdapter(injectedCtx.remote.amibaConnectors);
      const disposeSync = injectedCtx.slots.inject("conversation.session.header.actions", () =>
        injectedCtx.slots.register({ name: "conversation.session.header.actions", id: "connector-desktop-sync", inject: () => ({ adapter }) }, DesktopSyncHeader),
      );
      // `connection` is a client-root service present regardless of this
      // plugin's own `inject` declaration above (mirrors how
      // dsh-plugin-agent-preset's client/data.ts consumes it) — read via
      // `ctx.get` at call time instead of adding it to `export const inject`.
      // Hoisted to ONE stable const so both seats hand their occupant the
      // same function identity: `ConnectQuestionScreen` keys its loader
      // effect off it, and a fresh closure per render would re-fetch forever.
      const loadPresets = () =>
        loadAgentPresets(ctx.get("connection") as unknown as PresetConnection);
      const disposeSection = injectedCtx.slots.inject("settings.section", () =>
        injectedCtx.slots.register(
          {
            name: "settings.section",
            id: SECTION_ID,
            children: { "amiba.connection.access": { kind: "list", scope: "root" } },
            order: 410,
            label: () =>
              document.documentElement.lang.toLowerCase().startsWith("zh")
                ? "连接"
                : "Connect",
            inject: () => ({
              adapter,
              navIcon: () => <Cable />,
              registry,
              loadPresets,
            }),
          },
          ConnectSettingsSection,
        ),
      );
      // The conversation seat for the chat wizard: KEYED by the question id
      // the `amiba_connect_add` tool blocks on, so every other question keeps
      // rendering the host's built-in banner (the dispatch fallback). The
      // seat is session-scoped, so the inject factory is handed a
      // `sessionId` — Connect's wizard is session-independent and ignores it.
      const disposeQuestionSeat = injectedCtx.slots.inject(
        "amiba.conversation.question",
        () =>
          injectedCtx.slots.register(
            {
              name: "amiba.conversation.question",
              key: CONNECT_WIZARD_QUESTION_ID,
              inject: () => ({ adapter, registry, loadPresets }),
            },
            ConnectQuestionScreen,
          ),
      );
      // The timeline row for the same tool, keyed by its wire name.
      const disposeToolview = injectedCtx.slots.inject(
        "tool.call.toolview",
        () =>
          injectedCtx.slots.register(
            { name: "tool.call.toolview", key: CONNECT_ADD_TOOL_NAME },
            ConnectAddToolview,
          ),
      );
      return () => {
        disposeMessageSource();
        messageSource.dispose();
        disposeGroup();
        disposeSync();
        group.dispose();
        disposeToolview();
        disposeQuestionSeat();
        disposeSection();
      };
    },
  );
  await sectionFiber;
  return async () => {
    await sectionFiber.dispose();
    await disposeRemote();
    await disposeRegistry();
  };
}
