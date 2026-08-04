import {
  Check,
  Copy,
  Fingerprint,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createHermesProfile,
  deleteHermesProfile,
  getHermesProfiles,
  renameHermesProfile,
  setActiveHermesProfile,
  type HermesProfile,
} from "@amiba/core";
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
import { HermesModelConfigTab } from "./HermesModelConfigTab";
import { SettingsMemory } from "./SettingsMemory";
import type { BridgeCapability } from "./capabilities";

export type AgentWorkspaceSection =
  | "behavior"
  | "models"
  | "multi-model-collaboration"
  | "skills"
  | "capabilities"
  | "memory";

function ProfileListRow({
  active,
  onClick,
  profile,
  selected,
}: {
  active: boolean;
  onClick: () => void;
  profile: HermesProfile;
  selected: boolean;
}) {
  const { t } = useT();
  return (
    <button
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors",
        selected ? "bg-secondary text-foreground" : "hover:bg-accent/60",
      )}
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

export function SettingsAgents({
  bridge,
  initialSection = "behavior",
}: {
  bridge?: BridgeCapability;
  initialSection?: AgentWorkspaceSection;
} = {}) {
  const { t } = useT();
  const [profiles, setProfiles] = useState<HermesProfile[]>([]);
  const [active, setActive] = useState("default");
  const [selectedName, setSelectedName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [cloneFrom, setCloneFrom] = useState("__fresh__");
  const [editingName, setEditingName] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [section, setSection] = useState<AgentWorkspaceSection>(initialSection);

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  const namedProfiles = useMemo(
    () =>
      profiles.filter(
        (profile) => !profile.is_default && profile.name !== "default",
      ),
    [profiles],
  );
  const selected = useMemo(
    () =>
      namedProfiles.find((profile) => profile.name === selectedName) ?? null,
    [namedProfiles, selectedName],
  );

  const refresh = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError(null);
      const result = await getHermesProfiles();
      setLoading(false);
      if (!result.ok) {
        setError(result.error || t("options.agents.loadFailed"));
        return;
      }
      const customProfiles = result.profiles.filter(
        (profile) => !profile.is_default && profile.name !== "default",
      );
      setProfiles(result.profiles);
      setActive(result.active);
      setSelectedName((value) => {
        if (customProfiles.some((profile) => profile.name === value)) {
          return value;
        }
        if (
          result.active !== "default" &&
          customProfiles.some((profile) => profile.name === result.active)
        ) {
          return result.active;
        }
        return customProfiles[0]?.name || "";
      });
    },
    [t],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selected) return;
    setEditingName(false);
    setRenameName(selected.name);
  }, [selected?.name]);

  async function activateProfile() {
    if (!selected) return;
    setSaving(true);
    const result = await setActiveHermesProfile(selected.name);
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
    const result = await createHermesProfile({
      name: createName.trim(),
      clone_from: cloneFrom === "__fresh__" ? undefined : cloneFrom,
      description: createDescription.trim(),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error || t("options.agents.createFailed"));
      return;
    }
    const nextName = createName.trim().toLowerCase().replace(/\s+/g, "-");
    setCreateOpen(false);
    setCreateName("");
    setCreateDescription("");
    setCloneFrom("__fresh__");
    await refresh(true);
    setSelectedName(nextName);
  }

  async function renameProfile() {
    if (!selected || !renameName.trim()) return;
    if (renameName.trim() === selected.name) {
      setEditingName(false);
      return;
    }
    setSaving(true);
    setError(null);
    const result = await renameHermesProfile(selected.name, renameName.trim());
    setSaving(false);
    if (!result.ok) {
      setError(result.error || t("options.agents.renameFailed"));
      return;
    }
    const nextName = renameName.trim().toLowerCase().replace(/\s+/g, "-");
    setEditingName(false);
    await refresh(true);
    setSelectedName(nextName);
  }

  async function removeProfile() {
    if (!selected) return;
    if (!confirm(t("options.agents.deleteConfirm", { name: selected.name }))) {
      return;
    }
    setSaving(true);
    const result = await deleteHermesProfile(selected.name);
    setSaving(false);
    if (!result.ok) {
      setError(result.error || t("options.agents.deleteFailed"));
      return;
    }
    setSelectedName("");
    await refresh(true);
  }

  const workspaceSections: Array<{
    id: AgentWorkspaceSection;
    label: string;
  }> = [
    { id: "behavior", label: t("options.agents.section.behavior") },
    { id: "models", label: t("options.agents.section.models") },
    {
      id: "multi-model-collaboration",
      label: t("options.models.virtual.navTitle"),
    },
    { id: "skills", label: t("options.nav.skills") },
    { id: "capabilities", label: t("options.nav.tools") },
    { id: "memory", label: t("options.nav.memory") },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r border-border/50">
          <div className="flex h-11 shrink-0 items-center justify-between px-3">
            <span className="text-xs font-medium text-muted-foreground">
              {t("options.agents.profiles")}
            </span>
            <span className="flex items-center gap-0.5">
              <Button
                aria-label={t("common.refresh")}
                className="h-7 w-7 rounded-full"
                disabled={loading}
                onClick={() => void refresh()}
                size="icon"
                type="button"
                variant="ghost"
              >
                <RefreshCw
                  className={cn("h-3.5 w-3.5", loading && "animate-spin")}
                />
              </Button>
              <Button
                aria-label={t("options.agents.create")}
                className="h-7 w-7 rounded-full"
                onClick={() => setCreateOpen(true)}
                size="icon"
                type="button"
                variant="ghost"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </span>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-0.5 px-2 pb-3">
              {loading && namedProfiles.length === 0
                ? Array.from({ length: 3 }, (_, index) => (
                    <div
                      className="h-14 animate-pulse rounded-xl bg-muted/60"
                      key={index}
                    />
                  ))
                : namedProfiles.map((profile) => (
                    <ProfileListRow
                      active={profile.name === active}
                      key={profile.name}
                      onClick={() => setSelectedName(profile.name)}
                      profile={profile}
                      selected={profile.name === selectedName}
                    />
                  ))}
            </div>
          </ScrollArea>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selected ? (
            <>
              <div className="flex h-14 shrink-0 items-center gap-3 px-6">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary">
                  <Fingerprint className="h-4 w-4" strokeWidth={1.8} />
                </span>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {editingName ? (
                    <Input
                      aria-label={t("options.agents.name")}
                      autoFocus
                      className="h-8 max-w-xs rounded-lg px-2 text-sm font-medium"
                      disabled={saving}
                      onBlur={() => void renameProfile()}
                      onChange={(event) => setRenameName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          event.currentTarget.blur();
                        }
                        if (event.key === "Escape") {
                          setRenameName(selected.name);
                          setEditingName(false);
                        }
                      }}
                      value={renameName}
                    />
                  ) : (
                    <button
                      aria-label={t("options.agents.rename")}
                      className="group/name -ml-1 flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-muted/55"
                      onClick={() => {
                        setRenameName(selected.name);
                        setEditingName(true);
                      }}
                      type="button"
                    >
                      <span className="truncate text-sm font-medium">
                        {selected.name}
                      </span>
                      <Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/name:opacity-70 group-focus-visible/name:opacity-70" />
                    </button>
                  )}
                  {selected.name === active ? (
                    <Badge className="rounded-full" variant="success">
                      {t("options.agents.defaultShort")}
                    </Badge>
                  ) : null}
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  {selected.name !== active ? (
                    <Button
                      disabled={saving}
                      onClick={() => void activateProfile()}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Check className="h-3.5 w-3.5" />
                      {t("options.agents.setActive")}
                    </Button>
                  ) : null}
                  <Button
                    aria-label={t("common.delete")}
                    className="h-8 w-8 rounded-full text-muted-foreground hover:bg-destructive/8 hover:text-destructive"
                    disabled={saving}
                    onClick={() => void removeProfile()}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <div className="flex h-10 shrink-0 items-end gap-1 overflow-x-auto border-b border-border/50 px-5">
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

              {error ? (
                <p
                  className="mx-6 mt-4 rounded-xl bg-destructive/8 px-3 py-2 text-xs text-destructive"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}

              {section === "behavior" ? (
                <AgentBehaviorEditor
                  description={selected.description}
                  key={selected.name}
                  onDescriptionSaved={(description) =>
                    setProfiles((items) =>
                      items.map((profile) =>
                        profile.name === selected.name
                          ? { ...profile, description }
                          : profile,
                      ),
                    )
                  }
                  profileId={selected.name}
                />
              ) : section === "models" ? (
                <HermesModelConfigTab
                  bridge={bridge}
                  selectedProfileId={selected.name}
                  view="models"
                />
              ) : section === "multi-model-collaboration" ? (
                <HermesModelConfigTab
                  bridge={bridge}
                  selectedProfileId={selected.name}
                  view="multi-model-collaboration"
                />
              ) : section === "skills" ? (
                <SkillsPage
                  embedded
                  key={selected.name}
                  profileId={selected.name}
                />
              ) : section === "capabilities" ? (
                <ToolsPage
                  embedded
                  key={selected.name}
                  profileId={selected.name}
                />
              ) : (
                <SettingsMemory
                  embedded
                  key={selected.name}
                  profileId={selected.name}
                />
              )}
            </>
          ) : loading ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8">
              <div className="max-w-sm text-center">
                <Fingerprint className="mx-auto h-6 w-6 text-muted-foreground/55" />
                <p className="mt-3 text-sm font-medium">
                  {t("options.agents.customEmptyTitle")}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {t("options.agents.customEmptyDescription")}
                </p>
                <Button
                  className="mt-4"
                  onClick={() => setCreateOpen(true)}
                  size="sm"
                  type="button"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("options.agents.create")}
                </Button>
              </div>
            </div>
          )}
        </main>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md rounded-2xl">
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
              <Label htmlFor="profile-description">
                {t("options.agents.role.title")}
              </Label>
              <Input
                id="profile-description"
                onChange={(event) => setCreateDescription(event.target.value)}
                placeholder={t("options.agents.role.placeholder")}
                value={createDescription}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("options.agents.startFrom")}</Label>
              <Select onValueChange={setCloneFrom} value={cloneFrom}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__fresh__">
                    {t("options.agents.fresh")}
                  </SelectItem>
                  {profiles.map((profile) => (
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
    </div>
  );
}
