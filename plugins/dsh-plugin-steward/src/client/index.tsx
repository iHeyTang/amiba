import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
// Type-only: SlotMap entries for `amiba.sessions.list.group` /
// `amiba.sessions.item.menu` / `amiba.message.source`.
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import type { ReactNode } from "react";

import { AMIBA_STEWARD_REMOTE } from "../remote.js";
import { STEWARD_PRESET_ID, STEWARD_SOURCE, type AdoptResult, type StewardTask } from "../types.js";
import { StewardNavigation } from "./StewardNavigation.js";
import { createStewardClientState, stewardGroupFace, stewardMenuFace } from "./state.js";

export const name = "amiba-steward-ui";
export const inject = ["slots", "remote", "layout", "sessions", "amibaSessionVisibility"];

const NAV_ID = "steward";
type StewardRemote = ClientContext["remote"]["amibaSteward"];

/**
 * Narrow structural view of `ISessions.list` (session id + subscribe), used
 * to cross the `ctx.sessions` ambient-type seam described at its one call
 * site below.
 */
interface StewardSessionsFace {
  list: {
    getSnapshot(): { current?: string };
    subscribe(listener: () => void): () => void;
  };
}

function errorOf(value: unknown): Error {
  if (value && typeof value === "object") {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return new Error(message);
  }
  return new Error(String(value));
}

async function valueOf<T>(promise: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>): Promise<T> {
  const result = await promise;
  if (!result.ok) throw errorOf(result.error);
  return result.value;
}

function copy() {
  return document.documentElement.lang.toLowerCase().startsWith("zh") ? "大管家" : "Steward";
}

/** Same resolution style as `copy()` above — the `steward.adopt` i18n
 *  strings, read outside React since the registered menu component is
 *  never mounted (see `NoopComponent`'s doc comment). */
function adoptCopy() {
  return document.documentElement.lang.toLowerCase().startsWith("zh") ? "交给大管家" : "Hand to steward";
}

/**
 * The registered component for `amiba.sessions.list.group` /
 * `amiba.sessions.item.menu` — never rendered. The shell reads these
 * registrations by enumerating `entriesOfSlot` and calling `options.label` /
 * `inject().claim` / `inject().run` directly (see
 * `createSessionGroupsSource` / `createSessionMenuItemsSource` in
 * `dsh-plugin-ui-shell`'s `session-list-sources.ts`); it never mounts the
 * component through a slot renderer. A component is still required to
 * satisfy `ctx.slots.register`'s signature, exactly like `settings.section`
 * registrants that also carry a component argument.
 */
function NoopComponent(): ReactNode {
  return null;
}

/** How often the adopted-session set is re-fetched while the plugin is mounted. */
const REFRESH_INTERVAL_MS = 20_000;

function openSession(sessionId: string): void {
  // The host's open-by-id seam (see cron's client): admits any valid DSH id,
  // including ones hidden from the history list.
  window.dispatchEvent(new CustomEvent("amiba:open-session", { detail: { sessionId } }));
}

export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(AMIBA_STEWARD_REMOTE);
  const state = createStewardClientState();
  const fiber = ctx.inject(
    ["slots", "remote.amibaSteward", "layout", "sessions", "amibaSessionVisibility"],
    (injectedCtx) => {
      const remote: StewardRemote = injectedCtx.remote.amibaSteward;
      const ensureStewardSession = () =>
        valueOf(remote.ensureStewardSession()).then(({ sessionId }) => {
          state.setStewardSessionId(sessionId);
          return sessionId;
        });
      const listTasks = (includeDone: boolean): Promise<StewardTask[]> => valueOf(remote.listTasks(includeDone));
      // `listTasks(true)` (include done) so a task's session keeps its
      // 大管家 group membership even after the task itself finishes — the
      // managed set is about "did the steward ever adopt this session", not
      // "is it still active".
      const refreshAdopted = () =>
        listTasks(true).then((tasks) => state.setAdopted(tasks.map((task) => task.sessionId))).catch(() => undefined);
      const adopt = (sessionId: string): Promise<AdoptResult> =>
        valueOf(remote.adopt({ sessionId })).then((result) => {
          // `stewardMenuFace`'s `run` already adds `result.task.sessionId`
          // to the local set optimistically; this refetches from the host
          // so the set stays correct even if adopt routed to a
          // different/existing session than the one that was clicked (see
          // `AdoptResult`).
          if (result.kind === "adopted") void refreshAdopted();
          return result;
        });
      // Learn the steward id up front so the nav row can highlight and the
      // header seats can tell the steward session apart before the first click.
      void ensureStewardSession().catch(() => undefined);
      void refreshAdopted();
      // Task completion, and adoption from another client/window, don't
      // notify this client — poll so the group set stays close to the
      // host's truth without a push channel.
      const refreshIntervalId = setInterval(() => void refreshAdopted(), REFRESH_INTERVAL_MS);

      const disposeHidden = injectedCtx.amibaSessionVisibility.hidePreset(STEWARD_PRESET_ID);
      // `ctx.sessions` resolves inconsistently in this package's TS program:
      // the plugin's server half pulls in `@deepseek-ai/dsh-session`'s
      // `SessionStore` (`list(): Session[]`) and the client half pulls in
      // `@deepseek-ai/dsh-client-runtime`'s `ISessions` (`list:
      // ObservableSnapshot<SessionListState>`) — both augment the SAME
      // `@deepseek-ai/cordis` Context.sessions in one whole-program
      // compile, and `skipLibCheck` lets the conflicting merge through
      // silently instead of failing loud. At runtime this file only ever
      // runs in the client plugin realm, so the object is unambiguously
      // `ISessions`; the cast below crosses that TS-only seam.
      const sessions = injectedCtx.sessions as unknown as StewardSessionsFace;
      const currentSessionId = () => sessions.list.getSnapshot().current;
      const subscribeCurrent = (listener: () => void) => sessions.list.subscribe(listener);

      const disposeNavigation = injectedCtx.slots.inject("amiba.workspace.navigation", () =>
        injectedCtx.slots.register(
          {
            name: "amiba.workspace.navigation",
            id: NAV_ID,
            order: 90,
            label: copy,
            inject: () => ({
              state,
              currentSessionId,
              subscribeCurrent,
              open: () => {
                void ensureStewardSession()
                  .then((id) => {
                    injectedCtx.layout.openChat();
                    openSession(id);
                  })
                  .catch(() => undefined);
              },
            }),
          },
          StewardNavigation as (props: PropsRuntime<"amiba.workspace.navigation">) => ReactNode,
        ),
      );
      // Session list: group every session the steward has ever adopted into
      // its own 「大管家」 section at the top of the sidebar. `claim` reads
      // `state.adoptedSessionIds()` live (see `stewardGroupFace` in
      // `state.ts`), so `refreshAdopted()` above — at apply, after an
      // adopt, and every `REFRESH_INTERVAL_MS` — is all that's needed to
      // keep it current; the registered component itself is never rendered
      // (see `NoopComponent`'s doc comment).
      const disposeGroup = injectedCtx.slots.inject("amiba.sessions.list.group", () =>
        injectedCtx.slots.register(
          {
            name: "amiba.sessions.list.group",
            id: NAV_ID,
            order: 50,
            label: copy,
            inject: () => stewardGroupFace(state),
          },
          NoopComponent,
        ),
      );
      // Session row ⋯ menu: "交给大管家" on every ordinary, not-yet-adopted
      // session. `stewardMenuFace` reads/writes the same `state` as the
      // group above, so adopting from here flips that live too.
      const disposeMenu = injectedCtx.slots.inject("amiba.sessions.item.menu", () =>
        injectedCtx.slots.register(
          {
            name: "amiba.sessions.item.menu",
            id: "steward-adopt",
            order: 50,
            label: adoptCopy,
            inject: () => stewardMenuFace(state, { adopt, refreshAdopted }),
          },
          NoopComponent,
        ),
      );
      // Chat bubble attribution: messages the steward dispatches carry
      // `source.plugin === STEWARD_SOURCE` (see `service.ts`'s relay send),
      // so the bubble shows "来自 大管家" instead of the raw plugin id. Purely
      // declarative — no business face, see `amiba.message.source`'s doc
      // comment in dsh-plugin-ui-shell.
      const disposeMessageSource = injectedCtx.slots.inject("amiba.message.source", () =>
        injectedCtx.slots.register(
          {
            name: "amiba.message.source",
            id: STEWARD_SOURCE,
            order: 50,
            label: copy,
          },
          NoopComponent,
        ),
      );
      return () => {
        clearInterval(refreshIntervalId);
        disposeMessageSource();
        disposeMenu();
        disposeGroup();
        disposeNavigation();
        disposeHidden();
      };
    },
  );
  await fiber;
  return async () => {
    await fiber.dispose();
    await disposeRemote();
  };
}
