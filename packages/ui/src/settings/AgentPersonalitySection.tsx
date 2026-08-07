import {
  Check,
  Copy,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  deleteHermesPersonality,
  getHermesPersonalities,
  saveHermesPersonality,
  setSelectedHermesPersonality,
  type HermesPersonality,
} from "@amiba/core";
import { useT } from "@amiba/i18n";

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  cn,
} from "../primitives";

interface PersonalityDraft {
  builtin: boolean;
  description: string;
  existing: boolean;
  key: string;
  name: string;
  originalKey: string | null;
  overridden: boolean;
  style: string;
  system_prompt: string;
  tone: string;
}

function draftFromPersonality(
  personality: HermesPersonality,
): PersonalityDraft {
  return {
    builtin: personality.builtin,
    description: personality.description,
    existing: true,
    key: personality.key,
    name: personality.name || personality.key,
    originalKey: personality.key,
    overridden: personality.overridden,
    style: personality.style,
    system_prompt: personality.system_prompt,
    tone: personality.tone,
  };
}

function emptyDraft(): PersonalityDraft {
  return {
    builtin: false,
    description: "",
    existing: false,
    key: "",
    name: "",
    originalKey: null,
    overridden: false,
    style: "",
    system_prompt: "",
    tone: "",
  };
}

function keyFromName(name: string, existing: Set<string>): string {
  const base =
    name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "custom-mode";
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function AgentPersonalitySection({ profileId }: { profileId: string }) {
  const { t } = useT();
  const [items, setItems] = useState<HermesPersonality[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<PersonalityDraft | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getHermesPersonalities(profileId);
    setLoading(false);
    if (!result.ok) {
      setError(result.error || t("options.agents.personality.loadFailed"));
      return;
    }
    setItems(result.personalities);
    setError(null);
  }, [profileId, t]);

  useEffect(() => {
    setItems([]);
    setDraft(null);
    void load();
  }, [load]);

  const keys = useMemo(() => new Set(items.map((item) => item.key)), [items]);
  const normalizedName = draft?.name.trim().toLocaleLowerCase() || "";
  const nameAvailable =
    !draft ||
    items.every(
      (item) =>
        item.key === draft.originalKey ||
        (item.name || item.key).trim().toLocaleLowerCase() !== normalizedName,
    );
  const canSave =
    Boolean(draft?.name.trim()) &&
    Boolean(draft?.system_prompt.trim()) &&
    nameAvailable;
  const selectedKey = items.find((item) => item.selected)?.key || "__none__";

  async function save() {
    if (!draft || !canSave) return;
    setSaving(true);
    const personality = draft.existing
      ? draft
      : { ...draft, key: keyFromName(draft.name, keys) };
    const result = await saveHermesPersonality(
      profileId,
      personality,
      draft.originalKey || undefined,
    );
    setSaving(false);
    if (!result.ok) {
      setError(result.error || t("options.agents.personality.saveFailed"));
      return;
    }
    setDraft(null);
    await load();
  }

  async function selectDefault(key: string) {
    if (selecting) return;
    setSelecting(true);
    setError(null);
    const normalized = key === "__none__" ? undefined : key;
    const result = await setSelectedHermesPersonality(profileId, normalized);
    setSelecting(false);
    if (!result.ok) {
      setError(result.error || t("options.agents.personality.selectFailed"));
      return;
    }
    setItems((current) =>
      current.map((item) => ({
        ...item,
        selected: item.key === normalized,
      })),
    );
  }

  async function removeOrReset() {
    if (!draft?.existing) return;
    const action = draft.builtin
      ? t("options.agents.personality.reset")
      : t("common.delete");
    if (
      !confirm(
        t("options.agents.personality.deleteConfirm", {
          action,
          name: draft.name,
        }),
      )
    ) {
      return;
    }
    setSaving(true);
    const result = await deleteHermesPersonality(profileId, draft.key);
    setSaving(false);
    if (!result.ok) {
      setError(result.error || t("options.agents.personality.deleteFailed"));
      return;
    }
    setDraft(null);
    await load();
  }

  return (
    <section className="space-y-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">
              {t("options.agents.personality.title")}
            </h3>
            {!loading ? (
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {items.length}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {t("options.agents.personality.description")}
          </p>
        </div>
        <Button
          aria-label={t("options.agents.personality.create")}
          className="h-7 w-7 shrink-0 rounded-full"
          onClick={() => setDraft(emptyDraft())}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center gap-4 rounded-xl border border-border/55 px-3.5 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">
            {t("options.agents.personality.defaultLabel")}
          </p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
            {t("options.agents.personality.defaultDescription")}
          </p>
        </div>
        <Select
          disabled={loading || selecting || items.length === 0}
          onValueChange={(value) => void selectDefault(value)}
          value={selectedKey}
        >
          <SelectTrigger
            aria-label={t("options.agents.personality.defaultLabel")}
            className="h-8 w-44 shrink-0 rounded-lg text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">
              {t("options.agents.personality.defaultNone")}
            </SelectItem>
            {items.map((item) => (
              <SelectItem key={item.key} value={item.key}>
                {item.name || item.key}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/55">
        <div className="max-h-64 overflow-y-auto">
          {loading && items.length === 0 ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <button
              className="flex h-20 w-full items-center justify-center text-xs text-muted-foreground transition-colors hover:bg-muted/35"
              onClick={() => setDraft(emptyDraft())}
              type="button"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              {t("options.agents.personality.create")}
            </button>
          ) : (
            items.map((item) => (
              <button
                className="group flex min-h-12 w-full items-center gap-3 border-b border-border/40 px-3.5 text-left transition-colors last:border-b-0 hover:bg-muted/35"
                key={item.key}
                onClick={() => setDraft(draftFromPersonality(item))}
                type="button"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/55 text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-medium">
                      {item.name || item.key}
                    </span>
                    {item.builtin && !item.overridden ? (
                      <span className="shrink-0 text-[9px] text-muted-foreground/75">
                        {t("common.builtin")}
                      </span>
                    ) : null}
                    {item.selected ? (
                      <span className="shrink-0 text-[9px] font-medium text-primary">
                        {t("options.agents.personality.defaultBadge")}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                    {item.description || item.preview}
                  </span>
                </span>
                <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            ))
          )}
        </div>
      </div>

      {error ? (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Dialog
        open={Boolean(draft)}
        onOpenChange={(open) => !open && setDraft(null)}
      >
        <DialogContent className="max-h-[min(82vh,42rem)] overflow-y-auto" size="md">
          {draft ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {draft.existing
                    ? t("options.agents.personality.edit")
                    : t("options.agents.personality.create")}
                  {draft.builtin && !draft.overridden ? (
                    <Badge className="rounded-full" variant="secondary">
                      {t("common.builtin")}
                    </Badge>
                  ) : null}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  {t("options.agents.personality.description")}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="personality-name">
                    {t("options.agents.personality.name")}
                  </Label>
                  <Input
                    id="personality-name"
                    onChange={(event) =>
                      setDraft((value) =>
                        value
                          ? {
                              ...value,
                              name: event.target.value,
                            }
                          : value,
                      )
                    }
                    maxLength={80}
                    placeholder={t(
                      "options.agents.personality.namePlaceholder",
                    )}
                    value={draft.name}
                  />
                  {!nameAvailable ? (
                    <p className="text-[10px] text-destructive">
                      {t("options.agents.personality.nameExists")}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="personality-description">
                    {t("options.agents.personality.summary")}
                  </Label>
                  <Input
                    id="personality-description"
                    onChange={(event) =>
                      setDraft((value) =>
                        value
                          ? { ...value, description: event.target.value }
                          : value,
                      )
                    }
                    placeholder={t(
                      "options.agents.personality.summaryPlaceholder",
                    )}
                    value={draft.description}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="personality-prompt">
                    {t("options.agents.personality.instruction")}
                  </Label>
                  <Textarea
                    className="min-h-36 resize-y"
                    id="personality-prompt"
                    onChange={(event) =>
                      setDraft((value) =>
                        value
                          ? { ...value, system_prompt: event.target.value }
                          : value,
                      )
                    }
                    placeholder={t(
                      "options.agents.personality.instructionPlaceholder",
                    )}
                    value={draft.system_prompt}
                  />
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="personality-tone">
                      {t("options.agents.personality.tone")}
                    </Label>
                    <Input
                      id="personality-tone"
                      onChange={(event) =>
                        setDraft((value) =>
                          value
                            ? { ...value, tone: event.target.value }
                            : value,
                        )
                      }
                      placeholder={t(
                        "options.agents.personality.tonePlaceholder",
                      )}
                      value={draft.tone}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="personality-style">
                      {t("options.agents.personality.style")}
                    </Label>
                    <Input
                      id="personality-style"
                      onChange={(event) =>
                        setDraft((value) =>
                          value
                            ? { ...value, style: event.target.value }
                            : value,
                        )
                      }
                      placeholder={t(
                        "options.agents.personality.stylePlaceholder",
                      )}
                      value={draft.style}
                    />
                  </div>
                </div>
              </div>

              <DialogFooter className="sm:justify-between">
                <div className="flex items-center gap-1">
                  {draft.existing && (!draft.builtin || draft.overridden) ? (
                    <Button
                      className={cn(
                        !draft.builtin &&
                          "text-destructive hover:bg-destructive/8 hover:text-destructive",
                      )}
                      disabled={saving}
                      onClick={() => void removeOrReset()}
                      type="button"
                      variant="ghost"
                    >
                      {draft.builtin ? (
                        <RotateCcw className="h-3.5 w-3.5" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      {draft.builtin
                        ? t("options.agents.personality.reset")
                        : t("common.delete")}
                    </Button>
                  ) : null}
                  {draft.existing ? (
                    <Button
                      disabled={saving}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          builtin: false,
                          existing: false,
                          key: "",
                          name: `${draft.name} copy`,
                          originalKey: null,
                          overridden: false,
                        })
                      }
                      type="button"
                      variant="ghost"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {t("options.agents.personality.duplicate")}
                    </Button>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => setDraft(null)}
                    type="button"
                    variant="ghost"
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    disabled={saving || !canSave}
                    onClick={() => void save()}
                    type="button"
                  >
                    {saving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    {t("common.save")}
                  </Button>
                </div>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
