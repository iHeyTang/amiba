import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import { SkillsDirectoryView } from "@amiba/ui/plugin/skills";
import type { AgentSkillsAdapter } from "@amiba/app-runtime/platform";
import { useMemo, type ReactNode } from "react";

import { AMIBA_SKILLS_REMOTE } from "../remote.js";

export const name = "amiba-skills-ui";
export const inject = ["slots", "remote"];

const SECTION_ID = "skills";
type SkillsRemote = ClientContext["remote"]["amibaSkills"];

type SkillsSectionProps = PropsRuntime<"amiba.settings.section"> & {
  adapter: AgentSkillsAdapter;
};

function SkillsSettings({
  adapter,
  headerActionsHost,
  useSessions,
}: SkillsSectionProps): ReactNode {
  const sessionState = useSessions((state) => state);
  const current = useMemo(() => {
    if (sessionState.current) return sessionState.current;
    return sessionState.ids
      .map((id) => sessionState.byId[id])
      .filter((item) => item && !item.origin)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0]?.id;
  }, [sessionState]);
  return (
    <SkillsDirectoryView
      adapter={adapter}
      headerActionsHost={headerActionsHost}
      sessionId={current}
    />
  );
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

export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(AMIBA_SKILLS_REMOTE);
  const sectionFiber = ctx.inject(
    ["slots", "remote.amibaSkills"],
    (injectedCtx) => {
      const remote: SkillsRemote = injectedCtx.remote.amibaSkills;
      const adapter: AgentSkillsAdapter = {
        list: (sessionId) => valueOf(remote.list(sessionId ?? null)),
        read: (skillName, sessionId) =>
          valueOf(remote.read(skillName, sessionId ?? null)),
        listFiles: (skillName, sessionId) =>
          valueOf(remote.listFiles(skillName, sessionId ?? null)),
        readFile: (skillName, path, sessionId) =>
          valueOf(remote.readFile(skillName, path, sessionId ?? null)),
        save: (skillName, document, sessionId) =>
          valueOf(remote.save(skillName, document, sessionId ?? null)),
        remove: async (skillName, sessionId) => {
          await valueOf(remote.removeSkill(skillName, sessionId ?? null));
        },
      };
      return injectedCtx.slots.inject("amiba.settings.section", () =>
        injectedCtx.slots.register(
          {
            name: "amiba.settings.section",
            id: SECTION_ID,
            order: 200,
            label: () =>
              document.documentElement.lang.toLowerCase().startsWith("zh")
                ? "技能"
                : "Skills",
            inject: () => ({ adapter }),
          },
          SkillsSettings,
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
