import {
  Check,
  Copy,
  Fingerprint,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  createAgentPreset,
  deleteAgentPreset,
  getAgentPresets,
  normalizeAgentPresetId,
  renameAgentPreset,
  setDefaultAgentPreset,
  type AgentPreset,
} from "@amiba/app-runtime/core";
import { useT } from "@amiba/i18n";

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PageContent,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from "../primitives";
import { SkillsPage } from "../skills";
import { ToolsPage } from "../usage";
import { AgentBehaviorEditor } from "./AgentBehaviorEditor";
import { SettingsMemory } from "./SettingsMemory";
import {
  SettingsPageActionButton,
  SettingsPageActions,
  useSettingsPageHeader,
} from "./page-chrome";
import type { SettingsPageProps } from "./settings-pages";

type AgentWorkspaceSection = string;

function ProfileListRow({
  active,
  onClick,
  profile,
}: {
  active: boolean;
  onClick: () => void;
  profile: AgentPreset;
}) {
  const { t } = useT();
  return (
    <button
      className="group flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-accent/60"
      onClick={onClick}
      type="button"
    >
      <Fingerprint
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          active ? "text-primary" : "text-muted-foreground/55",
        )}
        strokeWidth={1.8}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {profile.name}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
          {profile.description ||
            profile.model ||
            t("options.agents.noDescription")}
        </span>
      </span>
      {active ? (
        <span className="text-[10px] text-muted-foreground">
          {t("options.agents.defaultShort")}
        </span>
      ) : null}
    </button>
  );
}

function AgentPresetList({
  activeName,
  error,
  loading,
  onCreate,
  onOpen,
  onRefresh,
  profiles,
}: {
  activeName: string;
  error: string | null;
  loading: boolean;
  onCreate: () => void;
  onOpen: (name: string) => void;
  onRefresh: () => void;
  profiles: AgentPreset[];
}) {
  const { t } = useT();
  return (
    <>
      <SettingsPageActions>
        <SettingsPageActionButton
          aria-label={t("common.refresh")}
          icon
          onClick={onRefresh}
          type="button"
          variant="ghost"
        >
          <RefreshCw className={cn(loading && "animate-spin")} />
        </SettingsPageActionButton>
        <SettingsPageActionButton onClick={onCreate} type="button">
          <Plus />
          {t("options.agents.create")}
        </SettingsPageActionButton>
      </SettingsPageActions>
      <ScrollArea className="min-h-0 flex-1">
        <PageContent bodyClassName="space-y-1" size="md">
          {error ? (
            <p
              className="rounded-xl bg-destructive/8 px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          {loading && profiles.length === 0 ? (
            Array.from({ length: 3 }, (_, index) => (
              <div
                className="h-14 animate-pulse rounded-xl bg-muted/60"
                key={index}
              />
            ))
          ) : profiles.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <Fingerprint className="h-6 w-6 text-muted-foreground/55" />
              <p className="mt-3 text-sm font-medium">
                {t("options.agents.customEmptyTitle")}
              </p>
              <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                {t("options.agents.customEmptyDescription")}
              </p>
              <Button
                className="mt-4"
                onClick={onCreate}
                size="sm"
                type="button"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("options.agents.create")}
              </Button>
            </div>
          ) : (
            profiles.map((profile) => (
              <ProfileListRow
                active={profile.name === activeName}
                key={profile.name}
                onClick={() => onOpen(profile.name)}
                profile={profile}
              />
            ))
          )}
        </PageContent>
      </ScrollArea>
    </>
  );
}

function AgentPresetDetail({
  error,
  isActive,
  onActivate,
  onBack,
  onDelete,
  onDescriptionSaved,
  onRename,
  presetSections,
  profile,
  renderPresetSection,
  saving,
}: {
  error: string | null;
  isActive: boolean;
  onActivate: () => void;
  onBack: () => void;
  onDelete: () => void;
  onDescriptionSaved: (description: string) => void;
  onRename: (newName: string) => void;
  presetSections?: readonly { id: string; label: string }[];
  profile: AgentPreset;
  renderPresetSection?: (
    sectionId: string,
    owner: { profileId: string },
  ) => ReactNode;
  saving: boolean;
}) {
  const { t } = useT();
  const [section, setSection] = useState<AgentWorkspaceSection>("behavior");
  const [editingName, setEditingName] = useState(false);
  const [renameDraft, setRenameDraft] = useState(profile.name);
  const ledgerIds = useMemo(
    () => new Set((presetSections ?? []).map((entry) => entry.id)),
    [presetSections],
  );

  useSettingsPageHeader({ title: profile.name, onBack });

  useEffect(() => {
    setEditingName(false);
    setRenameDraft(profile.name);
  }, [profile.name]);

  function submitRename() {
    setEditingName(false);
    const trimmed = renameDraft.trim();
    if (!trimmed || trimmed === profile.name) return;
    onRename(trimmed);
  }

  // Hardcoded tabs stay until later tasks migrate each module to a ledger
  // registration (T2-T4). A ledger entry whose id matches one of these wins
  // — the hardcoded tab is dropped from the strip and its body defers to
  // renderPresetSection instead, so a later module flip is just registering.
  const hardcodedSections: Array<{ id: AgentWorkspaceSection; label: string }> =
    [
      { id: "skills", label: t("options.nav.skills") },
      { id: "capabilities", label: t("options.nav.tools") },
      { id: "memory", label: t("options.nav.memory") },
    ].filter((item) => !ledgerIds.has(item.id));

  const workspaceSections: Array<{
    id: AgentWorkspaceSection;
    label: string;
  }> = [
    { id: "behavior", label: t("options.agents.section.behavior") },
    ...hardcodedSections,
    ...(presetSections ?? []),
  ];

  return (
    <>
      <SettingsPageActions>
        {isActive ? (
          <Badge className="rounded-full" variant="success">
            {t("options.agents.defaultShort")}
          </Badge>
        ) : (
          <SettingsPageActionButton
            disabled={saving}
            onClick={onActivate}
            type="button"
            variant="outline"
          >
            <Check />
            {t("options.agents.setActive")}
          </SettingsPageActionButton>
        )}
        {profile.trust !== "system" && !isActive ? (
          <SettingsPageActionButton
            aria-label={t("common.delete")}
            className="text-muted-foreground hover:bg-destructive/8 hover:text-destructive"
            disabled={saving}
            icon
            onClick={onDelete}
            type="button"
            variant="ghost"
          >
            <Trash2 />
          </SettingsPageActionButton>
        ) : null}
      </SettingsPageActions>

      <div className="mx-auto w-full max-w-3xl shrink-0 px-7">
        {error ? (
          <p
            className="mb-3 rounded-xl bg-destructive/8 px-3 py-2 text-xs text-destructive"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <div className="flex h-11 shrink-0 items-center">
          {editingName ? (
            <Input
              aria-label={t("options.agents.name")}
              autoFocus
              className="h-8 max-w-xs rounded-lg px-2 text-sm font-medium"
              disabled={saving}
              onBlur={submitRename}
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                  setRenameDraft(profile.name);
                  setEditingName(false);
                }
              }}
              value={renameDraft}
            />
          ) : profile.trust !== "system" ? (
            <button
              aria-label={t("options.agents.rename")}
              className="group/name -ml-1 flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-muted/55"
              onClick={() => {
                setRenameDraft(profile.name);
                setEditingName(true);
              }}
              type="button"
            >
              <span className="truncate text-sm font-medium">
                {profile.name}
              </span>
              <Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/name:opacity-70 group-focus-visible/name:opacity-70" />
            </button>
          ) : (
            <span className="truncate text-sm font-medium">
              {profile.name}
            </span>
          )}
        </div>
        <div className="flex h-10 shrink-0 items-end gap-1 overflow-x-auto border-b border-border/50">
          {workspaceSections.map((item) => (
            <button
              aria-current={section === item.id ? "page" : undefined}
              className={cn(
                "relative h-9 shrink-0 whitespace-nowrap rounded-t-lg px-3 text-xs font-medium transition-colors",
                section === item.id
                  ? "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground"
                  : "text-muted-foreground hover:bg-muted/45 hover:text-foreground",
              )}
              key={item.id}
              onClick={() => setSection(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {section === "behavior" ? (
        <AgentBehaviorEditor
          description={profile.description}
          embedded
          key={profile.name}
          onDescriptionSaved={onDescriptionSaved}
          profileId={profile.name}
          sourceEditable={profile.trust !== "system"}
        />
      ) : ledgerIds.has(section) ? (
        renderPresetSection?.(section, { profileId: profile.name })
      ) : section === "skills" ? (
        <SkillsPage embedded key={profile.name} profileId={profile.name} />
      ) : section === "capabilities" ? (
        <ToolsPage embedded key={profile.name} profileId={profile.name} />
      ) : (
        <SettingsMemory embedded key={profile.name} profileId={profile.name} />
      )}
    </>
  );
}

export function SettingsAgentsPage({
  detail,
  onOpenDetail,
  presetSections,
  renderPresetSection,
}: SettingsPageProps) {
  const { t } = useT();
  const [profiles, setProfiles] = useState<AgentPreset[]>([]);
  const [active, setActive] = useState("default");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDisplayName, setCreateDisplayName] = useState("");
  const [cloneFrom, setCloneFrom] = useState("__default__");

  const namedProfiles = useMemo(
    () => profiles.filter((profile) => profile.trust === "user"),
    [profiles],
  );
  const selected = useMemo(
    () =>
      detail
        ? (namedProfiles.find((profile) => profile.name === detail) ?? null)
        : null,
    [detail, namedProfiles],
  );

  const refresh = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError(null);
      const result = await getAgentPresets();
      setLoading(false);
      if (!result.ok) {
        setError(result.error || t("options.agents.loadFailed"));
        return;
      }
      setProfiles(result.profiles);
      setActive(result.active);
    },
    [t],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Invalid drill-in id (deleted elsewhere, stale link) → back to the list
  // once presets have finished loading.
  useEffect(() => {
    if (detail && !loading && !selected) onOpenDetail(null);
  }, [detail, loading, selected, onOpenDetail]);

  async function activateProfile() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    const result = await setDefaultAgentPreset(selected.name);
    setSaving(false);
    if (!result.ok) {
      setError(result.error || t("options.agents.activateFailed"));
      return;
    }
    await refresh(true);
  }

  async function createProfile() {
    if (!createName.trim()) return;
    setSaving(true);
    setError(null);
    const result = await createAgentPreset({
      name: createName.trim(),
      clone_from: cloneFrom === "__default__" ? undefined : cloneFrom,
      displayName: createDisplayName.trim(),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error || t("options.agents.createFailed"));
      return;
    }
    const nextName = normalizeAgentPresetId(createName);
    setCreateOpen(false);
    setCreateName("");
    setCreateDisplayName("");
    setCloneFrom("__default__");
    await refresh(true);
    onOpenDetail(nextName);
  }

  async function renameProfile(newName: string) {
    if (!selected) return;
    setSaving(true);
    setError(null);
    const result = await renameAgentPreset(selected.name, newName);
    setSaving(false);
    if (!result.ok) {
      setError(result.error || t("options.agents.renameFailed"));
      return;
    }
    const nextName = normalizeAgentPresetId(newName);
    await refresh(true);
    onOpenDetail(nextName);
  }

  async function removeProfile() {
    if (!selected) return;
    if (!confirm(t("options.agents.deleteConfirm", { name: selected.name }))) {
      return;
    }
    setSaving(true);
    setError(null);
    const result = await deleteAgentPreset(selected.name);
    setSaving(false);
    if (!result.ok) {
      setError(result.error || t("options.agents.deleteFailed"));
      return;
    }
    await refresh(true);
    onOpenDetail(null);
  }

  if (detail && selected) {
    return (
      <AgentPresetDetail
        error={error}
        isActive={selected.name === active}
        onActivate={() => void activateProfile()}
        onBack={() => onOpenDetail(null)}
        onDelete={() => void removeProfile()}
        onDescriptionSaved={(description) =>
          setProfiles((items) =>
            items.map((profile) =>
              profile.name === selected.name
                ? { ...profile, description }
                : profile,
            ),
          )
        }
        onRename={(newName) => void renameProfile(newName)}
        presetSections={presetSections}
        profile={selected}
        renderPresetSection={renderPresetSection}
        saving={saving}
      />
    );
  }

  return (
    <>
      <AgentPresetList
        activeName={active}
        error={error}
        loading={loading}
        onCreate={() => setCreateOpen(true)}
        onOpen={(name) => onOpenDetail(name)}
        onRefresh={() => void refresh()}
        profiles={namedProfiles}
      />

      <Dialog onOpenChange={setCreateOpen} open={createOpen}>
        <DialogContent size="compact">
          <DialogHeader>
            <DialogTitle>{t("options.agents.create")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="profile-name">{t("options.agents.name")}</Label>
              <Input
                autoFocus
                id="profile-name"
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="researcher"
                value={createName}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-display-name">
                {t("options.agents.displayName")}
              </Label>
              <Input
                id="profile-display-name"
                onChange={(event) => setCreateDisplayName(event.target.value)}
                placeholder={t("options.agents.displayNamePlaceholder")}
                value={createDisplayName}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("options.agents.startFrom")}</Label>
              <Select onValueChange={setCloneFrom} value={cloneFrom}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">
                    {t("options.agents.fresh")}
                  </SelectItem>
                  {profiles
                    .filter(
                      (profile) =>
                        !profile.is_default && profile.name !== "default",
                    )
                    .map((profile) => (
                      <SelectItem key={profile.name} value={profile.name}>
                        <span className="inline-flex items-center gap-2">
                          <Copy className="h-3.5 w-3.5" />
                          {profile.is_default || profile.name === "default"
                            ? t("options.agents.cloneDefault")
                            : profile.name}
                        </span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setCreateOpen(false)} variant="ghost">
              {t("common.cancel")}
            </Button>
            <Button
              disabled={saving || !createName.trim()}
              onClick={() => void createProfile()}
            >
              {t("options.agents.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
