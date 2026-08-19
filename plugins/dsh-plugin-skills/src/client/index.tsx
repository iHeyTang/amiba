import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import { Sparkles } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import { AMIBA_SKILLS_REMOTE } from "../remote.js";
import { DshSkillsPage, type SkillsDirectoryAdapter } from "./DshSkillsPage.js";

export const name = "amiba-skills-ui";
export const inject = ["slots", "remote"];

const SECTION_ID = "skills";
type SkillsRemote = ClientContext["remote"]["amibaSkills"];

function sectionLabel(): string {
  return document.documentElement.lang.toLowerCase().startsWith("zh")
    ? "技能"
    : "Skills";
}

type SkillsSectionProps = PropsRuntime<"amiba.settings.section"> & {
  adapter: SkillsDirectoryAdapter;
};

function SkillsSettings({
  adapter,
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
    <DshSkillsPage adapter={adapter} sessionId={current} />
  );
}

type SkillsPresetSectionProps = PropsRuntime<"amiba.agentPreset.section"> & {
  adapter: SkillsDirectoryAdapter;
};

/**
 * Preset-detail tab (M1 `amiba.agentPreset.section`): the same directory
 * view, scoped to the owning preset's most relevant DSH session instead of
 * the global "current" session the top-level Settings section follows.
 *
 * `amibaSkills/*` calls take a `sessionId`, not a preset id — the mapping
 * from `profileId` to a session rides the engine-native `useSessions`
 * standard hook (every session carries its composing `agentPreset`), never
 * the host `platform.agentSessions` adapter.
 */
function SkillsPresetSection({
  adapter,
  profileId,
  useSessions,
}: SkillsPresetSectionProps): ReactNode {
  const sessionState = useSessions((state) => state);
  // Strict match only: unlike the retired host `SkillsPage.tsx`, this does
  // NOT fall back to treating an untagged session (`agentPreset` absent) as
  // belonging to the "default" preset — that fallback existed to cover a
  // preset literally named "default" colliding with the sentinel meaning
  // "use the active preset", which cannot occur here since `profileId`
  // always arrives as a real, unambiguous preset id from the ledger owner.
  // Dropping it was a deliberate simplification, reviewed and accepted.
  const sessionId = useMemo(() => {
    const current = sessionState.current
      ? sessionState.byId[sessionState.current]
      : undefined;
    if (current && !current.origin && current.agentPreset === profileId) {
      return sessionState.current;
    }
    return sessionState.ids
      .map((id) => sessionState.byId[id])
      .filter(
        (item) => item && !item.origin && item.agentPreset === profileId,
      )
      .sort((left, right) => right.updatedAt - left.updatedAt)[0]?.id;
  }, [sessionState, profileId]);
  return <DshSkillsPage adapter={adapter} embedded sessionId={sessionId} />;
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
      const adapter: SkillsDirectoryAdapter = {
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
      const disposeSection = injectedCtx.slots.inject(
        "amiba.settings.section",
        () =>
          injectedCtx.slots.register(
            {
              name: "amiba.settings.section",
              id: SECTION_ID,
              order: 200,
              label: sectionLabel,
              inject: () => ({ adapter, navIcon: () => <Sparkles /> }),
            },
            SkillsSettings,
          ),
      );
      const disposePresetSection = injectedCtx.slots.inject(
        "amiba.agentPreset.section",
        () =>
          injectedCtx.slots.register(
            {
              name: "amiba.agentPreset.section",
              id: SECTION_ID,
              order: 200,
              label: sectionLabel,
              inject: () => ({ adapter }),
            },
            SkillsPresetSection,
          ),
      );
      return () => {
        disposePresetSection();
        disposeSection();
      };
    },
  );
  await sectionFiber;
  return async () => {
    await sectionFiber.dispose();
    await disposeRemote();
  };
}
