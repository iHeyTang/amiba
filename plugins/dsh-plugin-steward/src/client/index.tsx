import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
// Type-only: SlotMap entries for the official conversation header seats.
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import type { ReactNode } from "react";

import { AMIBA_STEWARD_REMOTE } from "../remote.js";
import type { AdoptResult, StewardTask } from "../types.js";
import { AdoptAction } from "./AdoptAction.js";
import { StewardNavigation } from "./StewardNavigation.js";
import { TaskBoard } from "./TaskBoard.js";
import { createStewardClientState } from "./state.js";

export const name = "amiba-steward-ui";
export const inject = ["slots", "remote", "layout", "sessions", "amibaSessionVisibility"];

const NAV_ID = "steward";
type StewardRemote = ClientContext["remote"]["amibaSteward"];

// Deliberately NOT imported from `../preset-seed.js`: that module's
// top-level `import ... from "node:fs/promises"` is fine on the server
// (seedAgentPresets runs in the host plugin), but Rollup binds every
// top-level import while building this browser bundle regardless of
// tree-shaking, and the Node builtin has no browser stub with these named
// exports — the build fails before dead code elimination ever drops the
// unused seeding function. No other plugin's client entry crosses into its
// own fs-touching module for a shared id constant (see
// dsh-plugin-cron/src/client, which never imports from store.ts); this
// literal is that same boundary, kept in sync with `STEWARD_PRESET_ID` in
// ../preset-seed.ts by the exported id itself never changing post-seed.
const STEWARD_PRESET_ID = "amiba-steward";

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
      const adopt = (sessionId: string): Promise<AdoptResult> => valueOf(remote.adopt({ sessionId }));
      const refreshAdopted = () =>
        listTasks(true).then((tasks) => state.setAdopted(tasks.map((task) => task.sessionId))).catch(() => undefined);
      // Learn the steward id up front so the nav row can highlight and the
      // header seats can tell the steward session apart before the first click.
      void ensureStewardSession().catch(() => undefined);
      void refreshAdopted();

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
                void ensureStewardSession().then((id) => {
                  injectedCtx.layout.openChat();
                  openSession(id);
                });
              },
            }),
          },
          StewardNavigation as (props: PropsRuntime<"amiba.workspace.navigation">) => ReactNode,
        ),
      );
      const disposeBoard = injectedCtx.slots.inject("conversation.session.header.utilities", () =>
        injectedCtx.slots.register(
          {
            name: "conversation.session.header.utilities",
            id: "steward-board",
            order: 50,
            inject: () => ({ state, listTasks, openSession }),
          },
          (
            props: PropsRuntime<"conversation.session.header.utilities"> & {
              state: typeof state;
              listTasks: typeof listTasks;
              openSession: typeof openSession;
            },
          ) => (
            <TaskBoard sessionId={String(props.sessionId)} state={props.state} listTasks={props.listTasks} openSession={props.openSession} />
          ),
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
        disposeAdopt();
        disposeBoard();
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
