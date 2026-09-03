import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import {
  DshApiClient,
  createWebPlatformAdapter,
} from "@amiba/app-runtime/dsh-client";
import { hasPlatform, setPlatform } from "@amiba/app-runtime/platform";
import { seedDocumentLanguage } from "@amiba/i18n";
import {
  resolveSlotLabel,
  type PropsRenderSlots,
  type PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import { useEffect, type ReactNode } from "react";

import {
  AmibaProductShell,
  type AmibaShellSlot,
  type OnboardingStepRow,
  type SettingsOnboardingStepsSource,
  type SettingsSectionsSource,
} from "./product-shell.js";
import {
  createSessionsBridge,
  type AmibaSessionsBridge,
} from "./sessions-bridge.js";
import {
  createInputTriggerBridge,
  type AmibaInputTriggerBridge,
} from "./input-trigger-bridge.js";
import {
  connectOfficialLocale,
  LOCALE_SETTINGS_NAMESPACE,
} from "./locale-bridge.js";
import {
  installAmibaMessageCatalog,
  registerAmibaMessages,
} from "./messages.js";
import type { LocaleSettings } from "@deepseek-ai/dsh-client-locale/client";
import {
  AmibaCommandPopupSeat,
  AmibaSlashMenuSeat,
  COMMAND_POPUP_ENTRY_ID,
  SHADOW_PRIORITY,
  SLASH_MENU_ENTRY_ID,
} from "./trigger-seats.js";
import { TRIGGER_SOURCE_LABELS, officialTriggerSources } from "@amiba/ui";
import { AskUserQuestionToolview } from "./ask-toolview.js";
import { OFFICIAL_TOOLVIEWS } from "./official-toolviews.js";
import shellCss from "./styles.css?inline";

export const name = "amiba-ui-shell";
export const inject = ["slots", "sessions"];

const PACKAGE_ID = "@amiba/dsh-plugin-ui-shell";
const STYLE_ID = `${PACKAGE_ID}/product-shell.css`;
if (
  typeof document !== "undefined" &&
  document.querySelector(
    `style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`,
  ) === null
) {
  const tag = document.createElement("style");
  tag.dataset.plugin = PACKAGE_ID;
  tag.dataset.pluginCss = STYLE_ID;
  tag.textContent = shellCss;
  document.head.append(tag);
}

export type {
  AmibaAgentPresetSectionOwner,
  AmibaComposerModelPickerOwner,
  AmibaComposerModelSelection,
  AmibaRootSlot,
  AmibaWorkspaceNavigationOwner,
  AmibaWorkspaceViewOwner,
  // Official owner contracts inherited through the SDK: settings.section
  // ({ close }) from dsh-client-ui-settings; the four conversation seats
  // (header utilities and header actions: empty owner; input.model and
  // input.plan: { locked }) from dsh-client-ui-conversation; and
  // conversation.input.overlay (empty owner) from
  // dsh-client-ui-input-trigger.
  ConversationHeaderActionsOwnerProps,
  ConversationHeaderUtilitiesOwnerProps,
  ConversationInputModelOwnerProps,
  ConversationInputOverlayOwnerProps,
  ConversationInputPlanOwnerProps,
  SettingsSectionOwnerProps,
} from "@amiba/extension-sdk";

type AmibaRootProps = PropsRuntime<"root"> &
  PropsRenderSlots<AmibaShellSlot> & {
    dshClient: DshApiClient;
    settingsSections: SettingsSectionsSource;
    settingsOnboardingSteps: SettingsOnboardingStepsSource;
    openSettingsSection: (sectionId: string) => void;
    sessionsBridge: AmibaSessionsBridge;
    triggerRuntime: AmibaInputTriggerBridge;
  };

const ROOT_READY_EVENT = "amiba:dsh-root-ready";

/**
 * The one component registered into the official DSH `root` slot. It
 * constructs the whole product shell and hands `renderSlot` down as render
 * props — every plugin contribution renders in this one React tree through
 * the official dispatch. No DOM marker scanning, no portals: the former
 * data-amiba-dsh-* side-channel is gone (the only surviving data-amiba-dsh-*
 * attribute is `data-amiba-dsh-base-url`, a different contract owned by the
 * desktop renderer bootstrap).
 */
function AmibaRoot({
  renderSlot,
  dshClient,
  settingsSections,
  settingsOnboardingSteps,
  openSettingsSection,
  sessionsBridge,
  triggerRuntime,
  useSessions,
}: AmibaRootProps): ReactNode {
  useEffect(() => {
    // Boot handshake: the desktop renderer waits for this (or for the
    // [data-amiba-product-shell] node) before flushing queued deep links.
    window.dispatchEvent(new CustomEvent(ROOT_READY_EVENT));
  }, []);

  return (
    <AmibaProductShell
      dshClient={dshClient}
      openSettingsSection={openSettingsSection}
      renderSlot={renderSlot}
      sessionsBridge={sessionsBridge}
      settingsSections={settingsSections}
      settingsOnboardingSteps={settingsOnboardingSteps}
      triggerRuntime={triggerRuntime}
      useOfficialSessions={useSessions}
    />
  );
}

export interface AmibaLayoutService {
  toggleSidebar(): void;
  openDetails(): void;
  closeDetails(): void;
  openChat(): void;
  /**
   * Land on the empty-state home with no active session; an optional
   * `draft` pre-fills the composer WITHOUT sending, so a real session is
   * created only when the user actually submits.
   */
  openNewChat(draft?: string): void;
  openWorkspace(viewId: string): void;
  openSettings(sectionId?: string): void;
}

interface SettingsSectionRow {
  id: string;
  label: string;
  order: number;
  icon?: ReactNode;
}

/**
 * Amiba convention on top of the closed upstream slot-options shape: a
 * section's `inject` face may carry `navIcon` (a thunk returning the nav
 * glyph). The registration options type cannot grow an icon field, so the
 * ledger reads it from the business face instead; sections without one
 * fall back to the generic Blocks glyph. Official plugins registering into
 * `settings.section` simply carry no icon and get the fallback.
 */
function resolveSectionNavIcon(
  inject: ((...args: never[]) => Record<string, unknown>) | undefined,
): ReactNode {
  const navIcon = inject?.().navIcon;
  return typeof navIcon === "function"
    ? ((navIcon as () => ReactNode)() ?? undefined)
    : undefined;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    layout: AmibaLayoutService;
  }
}

function dispatchLayoutAction(
  action: string,
  detail: Record<string, unknown> = {},
): void {
  window.dispatchEvent(
    new CustomEvent("amiba:dsh-layout-action", {
      detail: { action, ...detail },
    }),
  );
}

/** Register Amiba as the one DSH root owner and declare its child authority. */
export async function apply(ctx: ClientContext): Promise<void> {
  const baseUrl =
    window.location.protocol === "file:"
      ? "http://dsh.internal"
      : window.location.origin;
  const dshClient = new DshApiClient({ baseUrl });
  if (!hasPlatform()) setPlatform(createWebPlatformAdapter(dshClient));
  // A provisional language for the window, published BEFORE any DSH Client
  // plugin registers so their initial labels never inherit index.html's
  // fallback language and then become stuck in a slot snapshot cache. It is
  // the browser-derived value — the same derivation the official locale
  // plugin makes for its own provisional locale — and it is replaced the
  // moment `connectOfficialLocale` installs the official service below.
  seedDocumentLanguage();
  // Amiba's product copy, before anything can render it. The OFFICIAL
  // registration happens further down, guarded by `ctx.inject(["locale"], …)`
  // and superseding this one; this unconditional install is what keeps the
  // shell rendering real strings in a composition where `locale` never
  // resolves — the same runtime-less path Quick-Ask takes.
  const disposeMessageCatalog = installAmibaMessageCatalog();
  document.title = "Amiba";
  const layout: AmibaLayoutService = {
    toggleSidebar: () => dispatchLayoutAction("toggle-sidebar"),
    openDetails: () => dispatchLayoutAction("open-details"),
    closeDetails: () => dispatchLayoutAction("close-details"),
    openChat: () => dispatchLayoutAction("open-chat"),
    openNewChat: (draft) =>
      dispatchLayoutAction("open-new-chat", draft ? { draft } : {}),
    openWorkspace: (viewId) =>
      dispatchLayoutAction("open-workspace", { viewId }),
    openSettings: (sectionId) =>
      dispatchLayoutAction("open-settings", { sectionId }),
  };

  ctx.effect(() => {
    let sectionsVersion = -1;
    let sectionsLanguage = "";
    let sections: readonly SettingsSectionRow[] = [];
    const sectionsSource = {
      getSnapshot: () => {
        const version = ctx.slots.getVersion("settings.section");
        const language = document.documentElement.lang;
        if (version !== sectionsVersion || language !== sectionsLanguage) {
          sectionsVersion = version;
          sectionsLanguage = language;
          sections = ctx.slots
            .entriesOfSlot("settings.section")
            .map((entry) => ({
              id: entry.options.id ?? "",
              label:
                resolveSlotLabel(entry.options.label) ?? entry.options.id ?? "",
              order: entry.options.order ?? 0,
              icon: resolveSectionNavIcon(entry.inject),
            }))
            .filter((entry) => entry.id.length > 0)
            .sort((left, right) => left.order - right.order);
        }
        return sections;
      },
      subscribe: (listener: () => void) => {
        const disposeSlotSubscription = ctx.slots.subscribe(
          "settings.section",
          listener,
        );
        const languageObserver = new MutationObserver(listener);
        languageObserver.observe(document.documentElement, {
          attributeFilter: ["lang"],
          attributes: true,
        });
        return () => {
          languageObserver.disconnect();
          disposeSlotSubscription();
        };
      },
    };
    // The onboarding ledger, projected exactly as upstream's shell projects
    // it (`ctx.slots.getVersion` cache key, `id` + `order`, ascending sort,
    // `ctx.slots.subscribe` as the change channel). ONE deviation, and it is
    // the same one Amiba's `settings.section` projection already makes:
    // `entriesOfSlot` instead of the raw `entries`, so a shadowed cell
    // contributes its winner once instead of every registration at that id.
    // The coordinator addresses steps by id and dispatches with
    // `{ only: stepId }`, which renders the elected entry either way.
    let stepsVersion = -1;
    let steps: readonly OnboardingStepRow[] = [];
    const onboardingSource = {
      getSnapshot: () => {
        const version = ctx.slots.getVersion("settings.onboarding");
        if (version !== stepsVersion) {
          stepsVersion = version;
          steps = ctx.slots
            .entriesOfSlot("settings.onboarding")
            .map((entry) => ({
              id: entry.options.id ?? "",
              order: entry.options.order ?? 0,
            }))
            .filter((entry) => entry.id.length > 0)
            .sort((left, right) => left.order - right.order);
        }
        return steps;
      },
      subscribe: (listener: () => void) =>
        ctx.slots.subscribe("settings.onboarding", listener),
    };
    const disposeLayout = ctx.reflect.provide("layout", layout);
    // R1 selection bridge: keep the official ctx.sessions selection (the
    // session resolution every official session-scoped slot renders under)
    // in lock-step with Amiba's own per-window sessions store. The official
    // side's external switches route through the existing Amiba
    // open-session path.
    const sessionsBridge = createSessionsBridge(ctx.sessions, (sessionId) => {
      window.dispatchEvent(
        new CustomEvent("amiba:open-session", { detail: { sessionId } }),
      );
    });
    // The OFFICIAL input-trigger pipeline. Services are resolved lazily on
    // every call (`ctx.get`) so boot order stays free and a disabled row is
    // simply an absent service rather than a crash.
    const triggerRuntime = createInputTriggerBridge({
      scopeOf: (sessionId) =>
        ctx.sessions.scope(sessionId as never) as unknown as
          | ClientContext
          | undefined,
      subscribeSessions: (listener) => ctx.sessions.list.subscribe(listener),
      inputTriggers: () =>
        ctx.get("inputTriggers") as unknown as ReturnType<
          Parameters<typeof createInputTriggerBridge>[0]["inputTriggers"]
        >,
      commandUi: () =>
        ctx.get("commandUi") as unknown as ReturnType<
          Parameters<typeof createInputTriggerBridge>[0]["commandUi"]
        >,
    });
    // Amiba's own `/` and `@` sources, published through the official
    // registry rather than a private one — so a plugin's `registerSource`
    // and Amiba's own land in the same menu, ranked by the same `order`.
    //
    // Guarded by `ctx.inject`, not registered eagerly: `apply` may well run
    // before `ui-input-trigger` has provided the service, and an eager call
    // would silently register nothing at all — the built-in skills and
    // session groups would simply never appear in-session.
    const sourcesFiber = ctx.inject(["inputTriggers"], (scope) => {
      scope.effect(
        () => triggerRuntime.registerSources(officialTriggerSources()),
        "amiba-ui-shell: built-in trigger sources",
      );
    });
    // THE language authority. `@amiba/i18n` follows the official locale
    // service, and the retired `settings.ui.language` preference is carried
    // over to it once. Guarded by `ctx.inject` rather than the plugin's own
    // `inject` list for the same reason the trigger sources are: `apply` may
    // run before `locale` / `settingsScope` are provided, and the product
    // shell must mount either way (without them Amiba simply keeps the
    // browser-derived fallback, exactly as Quick-Ask does).
    //
    // `connection` and `remote` are injected because `settingsScope.bind`
    // binds the namespace to the settings transport and the forwarded
    // settings invalidation on the CALLER's fiber.
    // Amiba's copy as ONE official namespace. Deliberately a SEPARATE fiber
    // from the authority/migration one below: registering the dictionary needs
    // `locale` and nothing else, so a composition without `settingsScope`
    // still gets real strings instead of raw keys.
    const messagesFiber = ctx.inject(["locale"], (scope) => {
      scope.effect(
        () => registerAmibaMessages(scope.locale),
        "amiba-ui-shell: Amiba locale namespace",
      );
    });
    const localeFiber = ctx.inject(
      ["locale", "settingsScope", "connection", "remote"],
      (scope) => {
        scope.effect(
          () =>
            connectOfficialLocale({
              locale: scope.locale,
              localeSettings: scope.settingsScope.bind<LocaleSettings>({
                namespace: LOCALE_SETTINGS_NAMESPACE,
              }),
              onError: (error) =>
                console.error("[amiba-ui-shell] locale bridge:", error),
            }),
          "amiba-ui-shell: official locale authority",
        );
      },
    );
    const disposeRoot = ctx.slots.register(
      {
        name: "root",
        // Data faces only — AmibaRoot itself constructs the product shell,
        // so the one component receiving `renderSlot` is also the one that
        // hands render props down into it. The product shell renders the
        // section-ledger navigation directly (no slot indirection), so the
        // nav's openSettings affordance rides this face too.
        inject: () => ({
          dshClient,
          settingsSections: sectionsSource,
          settingsOnboardingSteps: onboardingSource,
          openSettingsSection: (sectionId: string) =>
            layout.openSettings(sectionId),
          sessionsBridge,
          triggerRuntime,
        }),
        children: {
          "amiba.navigation.before": { kind: "list", scope: "root" },
          "amiba.navigation.after": { kind: "list", scope: "root" },
          "amiba.workspace.navigation": {
            kind: "list",
            scope: "root",
            inject: {
              openWorkspace: (viewId: string) => layout.openWorkspace(viewId),
            },
          },
          "amiba.workspace.view": { kind: "list", scope: "root" },
          // Official vocabulary: the right-aligned session-header utilities
          // strip, from @deepseek-ai/dsh-client-ui-conversation (replaces
          // the retired amiba.chat.header.after). SESSION scope from a
          // root-scoped parent is legal: neither ChildrenDecl nor the
          // runtime constrains a child's scope to its declarer's — the
          // scope axis only selects which standard kit the ENTRY's
          // components receive, and the renderer's StrictSessionEntry
          // renders null while no official session is current, so the home
          // view is unaffected.
          "conversation.session.header.utilities": {
            kind: "list",
            scope: "session",
          },
          // Official vocabulary: the TITLE-ADJACENT per-session action row
          // (list, session scope, EMPTY owner — the contract is explicit
          // that an action derives sessionId and everything else from the
          // standard session kit and its own inject face). A separate seat
          // from the utilities strip above, exactly as upstream splits
          // them, so an optional utility cannot reorder session context.
          // Amiba had no such region before P3; the chat content header
          // grew one that collapses to nothing while the seat is empty.
          "conversation.session.header.actions": {
            kind: "list",
            scope: "session",
          },
          "amiba.chat.content.overlay": { kind: "list", scope: "root" },
          // The session-less hero model seat (vendor) and its official
          // session-scoped counterpart: the composer dispatches
          // conversation.input.model while it has a session id, the hero
          // seat otherwise. Same root-declares-session-child shape as the
          // header utilities above.
          "amiba.composer.modelPicker": { kind: "list", scope: "root" },
          "conversation.input.model": { kind: "single", scope: "session" },
          // Official vocabulary: the named plan-status seat in the composer
          // tool row, immediately right of the access-mode control (single,
          // session scope, owner InputControlOwnerProps { locked } — the
          // same owner share as the model seat). No occupant today: the
          // official ui-plan package is disabled, so the seat renders
          // nothing until a plugin takes it, which is exactly the contract
          // ("unoccupied, the seat renders nothing at all").
          "conversation.input.plan": { kind: "single", scope: "session" },
          // Official vocabulary: the composer's floating overlay anchor,
          // from @deepseek-ai/dsh-client-ui-input-trigger (list, session
          // scope, NO owner share at all — every occupant reads its own
          // store and renders null while closed, so the seat costs nothing
          // when idle). This is where the official trigger menu
          // (ui-input-trigger's MenuView) and the official command popup
          // shell (ui-commands) both land.
          // DECLARATION-ANCHOR divergence, the same one already recorded for
          // tool.call.toolview: upstream declares this seat from
          // ui-conversation's composer entry (the InputBar that owns the
          // input machine), which Amiba has no equivalent of — its composer
          // is its own Lexical surface. Declaring it on this root instead is
          // legal and identical in key/kind/scope/owner; only the
          // declaration site differs. The render site is the composer card
          // (`[data-composer-card]`), which is the anchor the official
          // occupants position against and probe with `closest()`.
          "conversation.input.overlay": { kind: "list", scope: "session" },
          // Official vocabulary: the KEYED per-tool call row, from
          // @deepseek-ai/dsh-client-ui-tool (keyed, session scope, owner
          // ToolCallOwnerProps). Registration key = the wire tool name, an
          // OPEN domain, so this is the one seat whose occupants are not a
          // fixed list. DECLARATION-ANCHOR divergence, recorded once here and
          // in the SDK: upstream declares it from `conversation.chat.node`'s
          // `tool-call` entry (the Chat Node that owns the whole call tree),
          // which Amiba has no equivalent of — its conversation is its own
          // projection. Declaring it on this root instead is legal and the
          // same pattern the adopted conversation.* seats use; only the
          // declaration site differs, never the key/kind/scope/owner.
          "tool.call.toolview": { kind: "keyed", scope: "session" },
          // Amiba's keyed question seat: one entry per question id (a
          // plugin-owned question kind claims exactly its own id), `fallback`
          // is the built-in ClarifyBanner. Same keyed shape as
          // tool.call.toolview, whose key domain is the wire tool name.
          "amiba.conversation.question": { kind: "keyed", scope: "session" },
          // Official vocabulary: the settings-page ledger seat, inherited
          // from @deepseek-ai/dsh-client-ui-settings (owner: { close }).
          "settings.section": {
            kind: "list",
            scope: "root",
          },
          // The rest of the official `settings.*` family, all six of them,
          // all root-scoped, all inherited from
          // @deepseek-ai/dsh-client-ui-settings. DECLARATION-ANCHOR
          // divergence, the same one recorded for tool.call.toolview and
          // conversation.input.overlay: upstream declares these from
          // ui-settings-general's `sidebar.settings` entry (its SettingsRoot
          // owns the trigger button and the modal panel) and declares
          // settings.general.item from that package's General settings.section
          // entry. Amiba runs neither — its settings shell and its General
          // page are its own — so the seats are declared on this root.
          // Key, kind, scope and owner contract are the official ones.
          //
          // The trigger content of the sidebar's settings row; owner
          // { wide } is the sidebar column state, which the chat view knows.
          "settings.trigger": { kind: "single", scope: "root" },
          // The panel title text; the dialog is named after this node.
          "settings.header": { kind: "single", scope: "root" },
          // Shell-level actions in the page header, before Close.
          "settings.action": { kind: "list", scope: "root" },
          // The close button's visually-hidden label text.
          "settings.close": { kind: "single", scope: "root" },
          // Onboarding steps: the coordinator mounts exactly ONE at a time,
          // in registration order, and the step owns all of its own chrome.
          "settings.onboarding": { kind: "list", scope: "root" },
          // One preference row inside the General section (Amiba's
          // Appearance page). Empty owner by contract — a row draws its own
          // internals, including its label.
          "settings.general.item": { kind: "list", scope: "root" },
          "amiba.settings.content.overlay": {
            kind: "list",
            scope: "root",
          },
          // amiba.agentPreset.section is deliberately NOT declared here:
          // dsh-plugin-agent-preset declares it as a child of its own
          // settings-section entry (the amiba.tools.panel pattern).
          // Official vocabulary: the frame-wide click-through floating
          // layer, from @deepseek-ai/dsh-client-ui-layout.
          "shell.overlay": { kind: "list", scope: "root" },
        },
      },
      AmibaRoot,
    );
    // CELL SHADOWS of the two official `conversation.input.overlay` entries.
    // Same ids, `priority: -1` against their implicit `0`, so the ledger
    // elects Amiba's component per cell while the official SERVICES stay
    // live. Registered after the root because the root's children table is
    // what declares the seat.
    const disposeSlashMenu = ctx.slots.register(
      {
        name: "conversation.input.overlay",
        id: SLASH_MENU_ENTRY_ID,
        priority: SHADOW_PRIORITY,
        order: 0,
        inject: (sessionId) => ({
          controller: triggerRuntime.controllerFor(String(sessionId)),
          labels: TRIGGER_SOURCE_LABELS,
          loadingLabel: undefined,
        }),
      },
      AmibaSlashMenuSeat,
    );
    const disposeCommandPopup = ctx.slots.register(
      {
        name: "conversation.input.overlay",
        id: COMMAND_POPUP_ENTRY_ID,
        priority: SHADOW_PRIORITY,
        order: 1,
        inject: (sessionId) => {
          const popup = triggerRuntime.popupFor(String(sessionId));
          return {
            popup,
            retry: popup === undefined ? undefined : () => popup.retry(),
          };
        },
      },
      AmibaCommandPopupSeat,
    );
    // The keyed per-tool row for the official ask_user_question interaction:
    // Amiba's first `tool.call.toolview` occupant, composed from @amiba/ui's
    // generic ToolRowFrame — the reference pattern for any plugin that wants
    // a bespoke row for its own tool. Registered after the root because the
    // root's children table is what declares the seat.
    const disposeAskToolview = ctx.slots.inject("tool.call.toolview", () =>
      ctx.slots.register(
        { name: "tool.call.toolview", key: "ask_user_question" },
        AskUserQuestionToolview,
      ),
    );
    // Every official runtime tool's row, one occupant per wire name — the
    // presentation core deliberately does not carry (its fallback row is
    // generic by construction).
    const disposeOfficialToolviews = OFFICIAL_TOOLVIEWS.map(
      ({ key, component }) =>
        ctx.slots.inject("tool.call.toolview", () =>
          ctx.slots.register({ name: "tool.call.toolview", key }, component),
        ),
    );
    return () => {
      for (const dispose of disposeOfficialToolviews) dispose();
      disposeAskToolview();
      disposeCommandPopup();
      disposeSlashMenu();
      void localeFiber.dispose();
      void messagesFiber.dispose();
      disposeMessageCatalog();
      void sourcesFiber.dispose();
      disposeRoot();
      sessionsBridge.dispose();
      void disposeLayout();
    };
  }, "amiba-ui-shell: root and semantic child slots");
}
