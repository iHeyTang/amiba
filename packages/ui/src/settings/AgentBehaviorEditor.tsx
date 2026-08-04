import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  getHermesProfiles,
  getHermesProfileSoul,
  updateHermesProfileDescription,
  updateHermesProfileSoul,
} from "@amiba/core";
import { useT } from "@amiba/i18n";

import { Button, Input, Label, ScrollArea, Textarea } from "../primitives";
import { AgentPersonalitySection } from "./AgentPersonalitySection";

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

export function AgentBehaviorEditor({
  description,
  onDescriptionSaved,
  profileId,
}: {
  description: string;
  onDescriptionSaved?: (description: string) => void;
  profileId: string;
}) {
  const { t } = useT();
  const [descriptionDraft, setDescriptionDraft] = useState(description);
  const [savedDescription, setSavedDescription] = useState(description);
  const [soul, setSoul] = useState("");
  const [savedSoul, setSavedSoul] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDescriptionDraft(description);
    setSavedDescription(description);
  }, [description, profileId]);

  useEffect(() => {
    let cancelled = false;
    setSoul("");
    setSavedSoul("");
    setLoading(true);
    setError(null);
    void getHermesProfileSoul(profileId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.error || t("options.agents.soulLoadFailed"));
        return;
      }
      setSoul(result.content);
      setSavedSoul(result.content);
    });
    return () => {
      cancelled = true;
    };
  }, [profileId, t]);

  const normalizedDescription = descriptionDraft.trim();
  const descriptionDirty = normalizedDescription !== savedDescription;
  const soulDirty = soul !== savedSoul;
  const dirty = descriptionDirty || soulDirty;

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);

    if (descriptionDirty) {
      const result = await updateHermesProfileDescription(
        profileId,
        normalizedDescription,
      );
      if (!result.ok) {
        setSaving(false);
        setError(result.error || t("options.agents.saveFailed"));
        return;
      }
      setDescriptionDraft(normalizedDescription);
      setSavedDescription(normalizedDescription);
      onDescriptionSaved?.(normalizedDescription);
    }

    if (soulDirty) {
      const result = await updateHermesProfileSoul(profileId, soul);
      if (!result.ok) {
        setSaving(false);
        setError(result.error || t("options.agents.saveFailed"));
        return;
      }
      setSavedSoul(soul);
    }

    setSaving(false);
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto max-w-3xl space-y-7 p-6">
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
            <Label
              className="sr-only"
              htmlFor={`agent-description-${profileId}`}
            >
              {t("options.agents.role.title")}
            </Label>
            <Input
              className="h-9 rounded-xl"
              id={`agent-description-${profileId}`}
              onChange={(event) => setDescriptionDraft(event.target.value)}
              placeholder={t("options.agents.role.placeholder")}
              value={descriptionDraft}
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
              onChange={(event) => setSoul(event.target.value)}
              placeholder={t("options.agents.soul.placeholder")}
              value={soul}
            />
          )}
        </FormSection>

        <div className="flex justify-start">
          <Button
            disabled={loading || saving || !dirty}
            onClick={() => void save()}
            size="sm"
            type="button"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </div>

        <AgentPersonalitySection profileId={profileId} />
      </div>
    </ScrollArea>
  );
}

export function SettingsAssistantBehavior() {
  const { t } = useT();
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await getHermesProfiles();
    setLoading(false);
    if (!result.ok) {
      setError(result.error || t("options.agents.loadFailed"));
      return;
    }
    const root = result.profiles.find(
      (profile) => profile.is_default || profile.name === "default",
    );
    setDescription(root?.description || "");
  }, [t]);

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
        <p className="text-xs text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <AgentBehaviorEditor
      description={description}
      onDescriptionSaved={setDescription}
      profileId="default"
    />
  );
}
