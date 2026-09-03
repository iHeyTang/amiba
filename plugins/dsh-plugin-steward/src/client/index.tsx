import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
// Type-only: SlotMap entries for the official conversation header seats.
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import type { ReactNode } from "react";

import { AMIBA_STEWARD_REMOTE } from "../remote.js";
import { STEWARD_PRESET_ID, type AdoptResult, type StewardTask } from "../types.js";
import { AdoptAction } from "./AdoptAction.js";
import { StewardNavigation } from "./StewardNavigation.js";
import { createStewardClientState, stewardBadgeFace, stewardFilterFace } from "./state.js";

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

/**
 * The registered component for `amiba.sessions.item.badge` /
 * `amiba.sessions.list.filter` — never rendered. The shell reads these
 * registrations by enumerating `entriesOfSlot` and calling `options.label` /
 * `inject().resolve` / `inject().test` directly (see
 * `createSessionBadgesSource` / `createSessionFiltersSource` in
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
      // 大管家 badge/filter membership even after the task itself finishes —
      // the managed set is about "did the steward ever adopt this session",
      // not "is it still active".
      const refreshAdopted = () =>
        listTasks(true).then((tasks) => state.setAdopted(tasks.map((task) => task.sessionId))).catch(() => undefined);
      const adopt = (sessionId: string): Promise<AdoptResult> =>
        valueOf(remote.adopt({ sessionId })).then((result) => {
          // `AdoptAction` already adds `result.task.sessionId` to the local
          // set optimistically; this refetches from the host so the set
          // stays correct even if adopt routed to a different/existing
          // session than the one that was clicked (see `AdoptResult`).
          if (result.kind === "adopted") void refreshAdopted();
          return result;
        });
      // Learn the steward id up front so the nav row can highlight and the
      // header seats can tell the steward session apart before the first click.
      void ensureStewardSession().catch(() => undefined);
      void refreshAdopted();
      // Task completion, and adoption from another client/window, don't
      // notify this client — poll so the badge/filter set stays close to
      // the host's truth without a push channel.
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
      // Session list: mark every session the steward has ever adopted with
      // a 「大管家」 badge, and let the sidebar filter down to just those (or
      // just the un-adopted ones). Both faces read `state.adoptedSessionIds()`
      // live (see `stewardBadgeFace`/`stewardFilterFace` in `state.ts`), so
      // `refreshAdopted()` above — at apply, after an adopt, and every
      // `REFRESH_INTERVAL_MS` — is all that's needed to keep them current;
      // the registered component itself is never rendered (see
      // `NoopComponent`'s doc comment).
      const disposeBadge = injectedCtx.slots.inject("amiba.sessions.item.badge", () =>
        injectedCtx.slots.register(
          {
            name: "amiba.sessions.item.badge",
            id: NAV_ID,
            order: 50,
            label: copy,
            inject: () => stewardBadgeFace(state),
          },
          NoopComponent,
        ),
      );
      const disposeFilter = injectedCtx.slots.inject("amiba.sessions.list.filter", () =>
        injectedCtx.slots.register(
          {
            name: "amiba.sessions.list.filter",
            id: NAV_ID,
            order: 50,
            label: copy,
            inject: () => stewardFilterFace(state),
          },
          NoopComponent,
        ),
      );
      const disposeAdopt = injectedCtx.slots.inject("conversation.session.header.actions", () =>
        injectedCtx.slots.register(
          {
            name: "conversation.session.header.actions",
            id: "steward-adopt",
            order: 50,
            inject: () => ({ state, adopt }),
          },
          (
            props: PropsRuntime<"conversation.session.header.actions"> & {
              state: typeof state;
              adopt: typeof adopt;
            },
          ) => <AdoptAction sessionId={String(props.sessionId)} state={props.state} adopt={props.adopt} />,
        ),
      );
      return () => {
        clearInterval(refreshIntervalId);
        disposeAdopt();
        disposeFilter();
        disposeBadge();
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
