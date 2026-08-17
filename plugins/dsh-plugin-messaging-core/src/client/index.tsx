import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import { MessagingSettingsView } from "@amiba/ui/plugin/messaging";
import { useMemo, type ReactNode } from "react";

import type {
  MessageCenterSnapshot,
  MessageChannelInput,
  MessageChannelPatch,
  MessageChannelSecret,
} from "../remote.js";
import { AMIBA_MESSAGING_REMOTE } from "../remote.js";

export const name = "amiba-messaging-ui";
export const inject = ["slots", "remote"];

const SECTION_ID = "messaging";
type MessagingRemote = ClientContext["remote"]["amibaMessaging"];

type MessagingAdapter = {
  list(): Promise<MessageCenterSnapshot>;
  create(input: MessageChannelInput): Promise<MessageChannelSecret>;
  update(id: string, patch: MessageChannelPatch): Promise<MessageCenterSnapshot["channels"][number]>;
  remove(id: string): Promise<{ id: string; deleted: boolean }>;
  rotateSecret(id: string): Promise<MessageChannelSecret>;
};

type MessagingSectionProps = PropsRuntime<"amiba.settings.section"> & {
  adapter: MessagingAdapter;
};

function remoteError(value: unknown): Error {
  if (value && typeof value === "object") {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return new Error(message);
  }
  return new Error(String(value));
}

async function valueOf<T>(
  result: Promise<
    | { ok: true; value: T }
    | { ok: false; error: unknown }
  >,
): Promise<T> {
  const settled = await result;
  if (!settled.ok) throw remoteError(settled.error);
  return settled.value;
}

function MessagingSettings({
  adapter,
  headerActionsHost,
  useSessions,
}: MessagingSectionProps): ReactNode {
  const sessionState = useSessions((state) => state);
  const sessions = useMemo(
    () =>
      sessionState.ids.flatMap((id) => {
        const item = sessionState.byId[id];
        if (!item || item.origin) return [];
        return [
          {
            sessionId: item.id,
            title: item.title ?? item.displayTitle,
            createdAt: item.updatedAt,
            updatedAt: item.updatedAt,
            running: item.running,
            blank: item.blank,
            ...(item.cwd ? { cwd: item.cwd } : {}),
            ...(item.agentPreset ? { agentPreset: item.agentPreset } : {}),
          },
        ];
      }),
    [sessionState],
  );
  const sessionsAdapter = useMemo(
    () => ({ list: async () => sessions }),
    [sessions],
  );
  return (
    <MessagingSettingsView
      adapter={adapter}
      headerActionsHost={headerActionsHost}
      sessionsAdapter={sessionsAdapter}
    />
  );
}

/** Register messaging-core's management surface from the plugin's Client half. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(AMIBA_MESSAGING_REMOTE);
  const sectionFiber = ctx.inject(
    ["slots", "remote.amibaMessaging"],
    (injectedCtx) => {
      const remote: MessagingRemote = injectedCtx.remote.amibaMessaging;
      const adapter: MessagingAdapter = {
        list: () => valueOf(remote.list()),
        create: (input) => valueOf(remote.create(input)),
        update: (id, patch) => valueOf(remote.update(id, patch)),
        remove: (id) => valueOf(remote.removeChannel(id)),
        rotateSecret: (id) => valueOf(remote.rotate(id)),
      };
      return injectedCtx.slots.inject("amiba.settings.section", () =>
        injectedCtx.slots.register(
          {
            name: "amiba.settings.section",
            id: SECTION_ID,
            order: 400,
            label: () =>
              document.documentElement.lang.toLowerCase().startsWith("zh")
                ? "消息渠道"
                : "Message channels",
            inject: () => ({ adapter }),
          },
          MessagingSettings,
        ),
      );
    },
  );
  await sectionFiber;
  return async () => {
    await sectionFiber.dispose();
    await disposeRemote();
  };
}
