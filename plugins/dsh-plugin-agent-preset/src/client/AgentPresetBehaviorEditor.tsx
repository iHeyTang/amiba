import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Button,
  Input,
  Label,
  PageContent,
  ScrollArea,
  Textarea,
  usePluginT,
} from "@amiba/ui/plugin";

import type { AgentPresetsAdapter } from "./data.js";
import { agentPresetI18n } from "./i18n.js";

function FormSection({
  children,
  description,
  title,
}: {
  children: React.ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <section className="space-y-2.5">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? (
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/**
 * The preset detail's 行为与人设 tab: read-only projection of the preset's
 * description and SOUL.md composition, with an "Edit" affordance that hands
 * the preset document to the host opener. DSH-native only — the retired host
 * `AgentBehaviorEditor`'s non-DSH save path was dead code behind a platform
 * probe and did not move.
 */
export function AgentPresetBehaviorEditor({
  adapter,
  description,
  profileId,
  sourceEditable = true,
}: {
  adapter: AgentPresetsAdapter;
  description: string;
  profileId: string;
  sourceEditable?: boolean;
}) {
  const { t } = usePluginT(agentPresetI18n);
  const [soul, setSoul] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSoul("");
    setLoading(true);
    setError(null);
    void adapter.readAgentPresetComposition(profileId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.error || t("options.agents.soulLoadFailed"));
        return;
      }
      setSoul(result.content);
    });
    return () => {
      cancelled = true;
    };
  }, [adapter, profileId, t]);

  async function editSource() {
    setSaving(true);
    setError(null);
    const result = await adapter.openAgentPresetDocument(profileId);
    setSaving(false);
    if (!result.ok) {
      setError(result.error || t("options.agents.saveFailed"));
    } else if (result.path) {
      setError(result.path);
    }
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <PageContent bodyClassName="space-y-7" size="md">
        {error ? (
          <p
            className="rounded-xl bg-destructive/8 px-3 py-2 text-xs text-destructive"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <FormSection
          description={t("options.agents.role.description")}
          title={t("options.agents.role.title")}
        >
          <div className="space-y-1.5">
            <Label className="sr-only" htmlFor={`agent-description-${profileId}`}>
              {t("options.agents.role.title")}
            </Label>
            <Input
              className="h-9 rounded-xl"
              id={`agent-description-${profileId}`}
              placeholder={t("options.agents.role.placeholder")}
              readOnly
              value={description}
            />
          </div>
        </FormSection>

        <FormSection
          description={t("options.agents.soul.description")}
          title={t("options.agents.soul.title")}
        >
          {loading ? (
            <div className="flex h-56 items-center justify-center rounded-2xl bg-muted/25">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Textarea
              className="min-h-56 resize-y rounded-xl font-mono text-xs leading-relaxed"
              placeholder={t("options.agents.soul.placeholder")}
              readOnly
              value={soul}
            />
          )}
        </FormSection>

        {sourceEditable ? (
          <div className="flex justify-start">
            <Button
              disabled={loading || saving}
              onClick={() => void editSource()}
              size="sm"
              type="button"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {saving ? t("common.saving") : t("common.edit")}
            </Button>
          </div>
        ) : null}
      </PageContent>
    </ScrollArea>
  );
}
