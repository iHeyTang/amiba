import { useEffect, useState } from "react";
import { getAgentPresets, useSessions } from "@amiba/app-runtime/core";
import { getPlatform } from "@amiba/app-runtime/platform";

import { DshSkillsPage } from "./DshSkillsPage";

export function SkillsPage({
  embedded,
  profileId,
}: {
  profileId?: string;
  embedded?: boolean;
} = {}) {
  const platform = getPlatform();
  const sessions = useSessions();
  const [sessionId, setSessionId] = useState<string | undefined>(
    sessions.activeId || undefined,
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!platform.agentSessions) {
        if (!cancelled) setSessionId(sessions.activeId || undefined);
        return;
      }
      const presets = await getAgentPresets();
      const defaultProfileId = presets.ok ? presets.active : "default";
      const resolvedProfileId =
        profileId === "default" && presets.ok
          ? defaultProfileId
          : (profileId ?? defaultProfileId);
      const runtimeSessions = await platform.agentSessions.list();
      const matching = runtimeSessions
        .filter(
          (session) =>
            (session.agentPreset ?? defaultProfileId) === resolvedProfileId,
        )
        .sort((left, right) => right.updatedAt - left.updatedAt);
      const nextSessionId = matching.some(
        (session) => session.sessionId === sessions.activeId,
      )
        ? sessions.activeId
        : matching[0]?.sessionId;
      if (!cancelled) setSessionId(nextSessionId || undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [platform, profileId, sessions.activeId]);

  return (
    <DshSkillsPage
      adapter={platform.agentSkills!}
      sessionId={sessionId}
      embedded={embedded}
    />
  );
}
