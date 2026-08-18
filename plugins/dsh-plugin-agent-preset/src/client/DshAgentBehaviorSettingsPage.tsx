import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { usePluginT } from "@amiba/ui/plugin";

import { AgentPresetBehaviorEditor } from "./AgentPresetBehaviorEditor.js";
import type { AgentPresetsAdapter } from "./data.js";
import { agentPresetI18n } from "./i18n.js";

/**
 * The assistant-level 行为与人设 (Behavior & identity) settings page: the
 * moved host `SettingsAssistantBehavior`. Maps the page to the default
 * preset (the roster's `is_default` entry, `"default"` as the fallback id)
 * and renders the plugin's behavior projection for it. `sourceEditable` is
 * off — identical to the retired host page, which suppressed even the
 * Edit-source affordance at this level; presets are edited through the
 * 智能体预设 drill-in instead.
 */
export function DshAgentBehaviorSettingsPage({
  adapter,
}: {
  adapter: AgentPresetsAdapter;
}) {
  const { t } = usePluginT(agentPresetI18n);
  const [description, setDescription] = useState("");
  const [profileId, setProfileId] = useState("default");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await adapter.getAgentPresets();
    setLoading(false);
    if (!result.ok) {
      setError(result.error || t("options.agents.loadFailed"));
      return;
    }
    const root = result.profiles.find(
      (profile) => profile.is_default || profile.name === "default",
    );
    setProfileId(root?.name || "default");
    setDescription(root?.description || "");
  }, [adapter, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      </div>
    );
  }

  return (
    <AgentPresetBehaviorEditor
      adapter={adapter}
      description={description}
      profileId={profileId}
      sourceEditable={false}
    />
  );
}
