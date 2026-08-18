import {
  Blocks,
  ChevronDown,
  ChevronRight,
  Cpu,
  FileText,
  Folder,
  FolderGit2,
  FolderOpen,
  Library,
  Loader2,
  PackageOpen,
  Pencil,
  Plug,
  Plus,
  Search,
  Trash2,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgentSkillDocument,
  AgentSkillEntry,
  AgentSkillFileContent,
  AgentSkillFileEntry,
  AgentSkillsAdapter,
} from "@amiba/app-runtime/platform";
import {
  Button,
  CollectionState,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  MODEL_SETTINGS_SURFACE_CLASS,
  PageContent,
  ScrollArea,
  SettingsPageActionButton,
  SettingsPageActions,
  SettingsPageDescription,
  Textarea,
  cn,
  usePluginT as useT,
  useRefetchOnFocus,
} from "@amiba/ui/plugin";

type SourceBucket =
  | "all"
  | "project"
  | "user"
  | "runtime"
  | "bundled"
  | "custom"
  | "other";
type InvocationFilter = "model" | "user";

interface SourceBucketView {
  id: SourceBucket;
  label: string;
  description: string;
  count: number;
  icon: LucideIcon;
}

function sourceBucket(source: string): Exclude<SourceBucket, "all"> {
  if (source === "project-dsh" || source === "project-agents") return "project";
  if (source === "user-dsh" || source === "user-agents") return "user";
  if (source === "runtime") return "runtime";
  if (source === "bundled") return "bundled";
  if (source === "custom") return "custom";
  return "other";
}

function template(name: string): string {
  return `---\nname: ${JSON.stringify(name)}\ndescription: "Describe when this skill is useful."\nuser-invocable: true\ndisable-model-invocation: false\n---\n\n# ${name}\n\nWrite clear, bounded instructions for this skill.\n`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function resourceLabel(skill: AgentSkillEntry): string {
  const resource = skill.resourceBase;
  if (!resource) return skill.provider;
  if (resource.kind === "directory") return resource.path;
  if (resource.kind === "url") return resource.url;
  return resource.description;
}

interface SkillTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  children?: SkillTreeNode[];
}

function buildSkillTree(files: AgentSkillFileEntry[]): SkillTreeNode[] {
  const root: SkillTreeNode = { name: "", path: "", isDir: true, children: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let current = root;
    parts.forEach((segment, index) => {
      const last = index === parts.length - 1;
      if (last) {
        current.children?.push({
          name: segment,
          path: file.path,
          isDir: false,
          size: file.size,
        });
        return;
      }
      let directory = current.children?.find(
        (child) => child.isDir && child.name === segment,
      );
      if (!directory) {
        directory = {
          name: segment,
          path: parts.slice(0, index + 1).join("/"),
          isDir: true,
          children: [],
        };
        current.children?.push(directory);
      }
      current = directory;
    });
  }
  const sort = (node: SkillTreeNode, top: boolean) => {
    node.children?.sort((left, right) => {
      if (top && left.path === "SKILL.md") return -1;
      if (top && right.path === "SKILL.md") return 1;
      if (left.isDir !== right.isDir) return left.isDir ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
    node.children?.forEach((child) => sort(child, false));
  };
  sort(root, true);
  return root.children ?? [];
}

function collectDirectories(nodes: SkillTreeNode[]): string[] {
  return nodes.flatMap((node) =>
    node.isDir
      ? [node.path, ...collectDirectories(node.children ?? [])]
      : [],
  );
}

function flattenTree(
  nodes: SkillTreeNode[],
  expanded: Set<string>,
  depth = 0,
): Array<{ node: SkillTreeNode; depth: number }> {
  return nodes.flatMap((node) => [
    { node, depth },
    ...(node.isDir && expanded.has(node.path)
      ? flattenTree(node.children ?? [], expanded, depth + 1)
      : []),
  ]);
}

function SkillEditor({
  open,
  initialName,
  initialDocument,
  busy,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  initialName?: string;
  initialDocument?: string;
  busy: boolean;
  onOpenChange(open: boolean): void;
  onSave(name: string, document: string): Promise<void>;
}) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [document, setDocument] = useState("");

  useEffect(() => {
    if (!open) return;
    const nextName = initialName ?? "";
    setName(nextName);
    setDocument(initialDocument ?? (nextName ? template(nextName) : ""));
  }, [initialDocument, initialName, open]);

  const updateName = (value: string) => {
    setName(value);
    if (!initialName && (!document || document === template(name))) {
      setDocument(value ? template(value) : "");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(85vh,52rem)] flex-col gap-0 overflow-hidden p-0"
        size="lg"
      >
        <DialogHeader className="shrink-0 border-b border-border/55 px-5 py-4 pr-12">
          <DialogTitle>
            {initialName
              ? t("options.skills.dsh.edit")
              : t("options.skills.dsh.create")}
          </DialogTitle>
          <DialogDescription className="text-xs leading-5">
            {t("options.skills.dsh.editorHint")}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-muted/10 px-5 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="dsh-skill-name" className="text-xs">
              {t("options.skills.dsh.name")}
            </Label>
            <Input
              id="dsh-skill-name"
              value={name}
              onChange={(event) => updateName(event.target.value)}
              placeholder="my-skill"
              disabled={busy || Boolean(initialName)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dsh-skill-document" className="text-xs">
              SKILL.md
            </Label>
            <Textarea
              id="dsh-skill-document"
              value={document}
              onChange={(event) => setDocument(event.target.value)}
              className="min-h-[420px] resize-y bg-background font-mono text-xs leading-relaxed"
              spellCheck={false}
              disabled={busy}
            />
          </div>
        </div>
        <DialogFooter className="shrink-0 border-t border-border/55 bg-background px-5 py-3">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => void onSave(name.trim(), document)}
            disabled={busy || !name.trim() || !document.trim()}
          >
            {busy ? <Loader2 className="animate-spin" /> : null}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SkillViewer({
  adapter,
  sessionId,
  skill,
  onClose,
  onEdit,
}: {
  adapter: AgentSkillsAdapter;
  sessionId?: string;
  skill: AgentSkillEntry | null;
  onClose(): void;
  onEdit(skill: AgentSkillEntry): void;
}) {
  const { t } = useT();
  const [files, setFiles] = useState<AgentSkillFileEntry[]>([]);
  const [root, setRoot] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string>();
  const [body, setBody] = useState<AgentSkillFileContent>();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [loadingList, setLoadingList] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [listError, setListError] = useState<string>();
  const [fileError, setFileError] = useState<string>();

  useEffect(() => {
    if (!skill) return;
    let cancelled = false;
    setFiles([]);
    setRoot(resourceLabel(skill));
    setSelectedPath(undefined);
    setBody(undefined);
    setListError(undefined);
    setFileError(undefined);
    setLoadingList(true);
    void adapter
      .listFiles(skill.name, sessionId)
      .then((result) => {
        if (cancelled) return;
        setFiles(result.files);
        setRoot(result.root);
        setTruncated(result.truncated);
        const tree = buildSkillTree(result.files);
        setExpanded(new Set(collectDirectories(tree)));
        setSelectedPath(
          result.files.find((file) => file.path === "SKILL.md")?.path ??
            result.files[0]?.path,
        );
      })
      .catch((cause) => {
        if (!cancelled)
          setListError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, sessionId, skill]);

  useEffect(() => {
    if (!skill || !selectedPath) {
      setBody(undefined);
      return;
    }
    let cancelled = false;
    setBody(undefined);
    setFileError(undefined);
    setLoadingFile(true);
    void adapter
      .readFile(skill.name, selectedPath, sessionId)
      .then((result) => {
        if (!cancelled) setBody(result);
      })
      .catch((cause) => {
        if (!cancelled)
          setFileError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoadingFile(false);
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, selectedPath, sessionId, skill]);

  const tree = useMemo(() => buildSkillTree(files), [files]);
  const rows = useMemo(() => flattenTree(tree, expanded), [expanded, tree]);

  return (
    <Dialog open={Boolean(skill)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[80vh] max-h-[800px] flex-col gap-0 p-0" size="full">
        <DialogHeader className="border-b border-border bg-muted/30 px-4 py-3 pr-12">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="text-sm font-medium">{skill?.name ?? ""}</DialogTitle>
              <DialogDescription className="mt-1 truncate text-xs" title={root}>
                {skill ? `${skill.source} · ${skill.provider} · ${root}` : ""}
              </DialogDescription>
            </div>
            {skill?.editable ? (
              <Button size="sm" variant="outline" onClick={() => onEdit(skill)}>
                <Pencil />
                {t("options.skills.dsh.edit")}
              </Button>
            ) : null}
          </div>
        </DialogHeader>
        <div className="flex min-h-0 flex-1">
          <aside className="flex min-h-0 w-64 shrink-0 flex-col border-r border-border bg-muted/15">
            <div className="border-b border-border/50 px-3 py-1.5 text-xs uppercase tracking-wider text-muted-foreground/70">
              {t("options.skills.files", { count: files.length })}
              {truncated ? ` · ${t("options.skills.filesTruncated", { count: files.length })}` : ""}
            </div>
            <ScrollArea className="min-h-0 flex-1">
              {loadingList ? (
                <CollectionState className="min-h-32" icon={<Loader2 className="animate-spin" />}>
                  {t("options.skills.loading")}
                </CollectionState>
              ) : listError ? (
                <p className="px-3 py-3 text-xs text-destructive">{listError}</p>
              ) : files.length === 0 ? (
                <p className="px-3 py-3 text-xs text-muted-foreground">{t("options.skills.noFiles")}</p>
              ) : (
                <ul className="flex flex-col py-1">
                  {rows.map(({ node, depth }) => {
                    const indent = 8 + depth * 12;
                    if (node.isDir) {
                      const isExpanded = expanded.has(node.path);
                      return (
                        <li key={`d:${node.path}`}>
                          <button
                            type="button"
                            className="flex w-full items-center gap-1 py-1 pr-3 text-left text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                            style={{ paddingLeft: indent }}
                            onClick={() =>
                              setExpanded((current) => {
                                const next = new Set(current);
                                if (next.has(node.path)) next.delete(node.path);
                                else next.add(node.path);
                                return next;
                              })
                            }
                          >
                            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            {isExpanded ? <FolderOpen className="h-3 w-3" /> : <Folder className="h-3 w-3" />}
                            <span className="truncate font-mono">{node.name}</span>
                          </button>
                        </li>
                      );
                    }
                    return (
                      <li key={`f:${node.path}`}>
                        <button
                          type="button"
                          title={`${node.path} · ${formatFileSize(node.size ?? 0)}`}
                          className={cn(
                            "flex w-full items-center gap-1 py-1 pr-3 text-left text-sm",
                            selectedPath === node.path
                              ? "bg-muted text-foreground"
                              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                          )}
                          style={{ paddingLeft: indent + 16 }}
                          onClick={() => setSelectedPath(node.path)}
                        >
                          <FileText className="h-3 w-3 shrink-0" />
                          <span className="min-w-0 flex-1 truncate font-mono">{node.name}</span>
                          <span className="shrink-0 text-xs tabular-nums opacity-70">
                            {formatFileSize(node.size ?? 0)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </ScrollArea>
          </aside>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-border/50 bg-muted/10 px-3 py-1.5 text-xs">
              <span className="truncate font-mono text-muted-foreground">{selectedPath ?? "—"}</span>
              {body ? <span className="ml-2 tabular-nums text-muted-foreground/70">{formatFileSize(body.size)}</span> : null}
            </div>
            <ScrollArea className="min-h-0 flex-1 bg-background">
              {loadingFile ? (
                <CollectionState className="min-h-40" icon={<Loader2 className="animate-spin" />}>
                  {t("options.skills.reading")}
                </CollectionState>
              ) : fileError ? (
                <p className="px-4 py-3 text-xs text-destructive">{fileError}</p>
              ) : body?.encoding === "binary" ? (
                <p className="px-4 py-3 text-xs text-muted-foreground">{t("options.skills.binaryFile", { size: formatFileSize(body.size) })}</p>
              ) : body?.encoding === "too-large" ? (
                <p className="px-4 py-3 text-xs text-muted-foreground">{t("options.skills.fileTooLarge", { size: formatFileSize(body.size) })}</p>
              ) : body?.content != null ? (
                <pre data-selection="text" className="whitespace-pre-wrap break-words px-4 py-3 font-mono text-xs leading-relaxed">
                  {body.content}
                </pre>
              ) : (
                <p className="px-4 py-3 text-xs text-muted-foreground">{t("options.skills.selectFile")}</p>
              )}
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DshSkillsPage({
  adapter,
  sessionId,
  embedded = false,
  headerActionsHost,
}: {
  adapter: AgentSkillsAdapter;
  sessionId?: string;
  embedded?: boolean;
  headerActionsHost?: () => HTMLElement | null;
}) {
  const { t } = useT();
  const [skills, setSkills] = useState<AgentSkillEntry[]>([]);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceBucket>("all");
  const [invocation, setInvocation] = useState<Set<InvocationFilter>>(() => new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<AgentSkillEntry | null>(null);
  const [editing, setEditing] = useState<Partial<AgentSkillDocument> | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adapter.list(sessionId || undefined);
      setSkills(result.skills);
    } catch (cause) {
      setSkills([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [adapter, sessionId]);

  useEffect(() => void refresh(), [refresh]);
  useRefetchOnFocus(() => void refresh());

  const sources = useMemo<SourceBucketView[]>(() => {
    const count = (bucket: SourceBucket) =>
      bucket === "all"
        ? skills.length
        : skills.filter((skill) => sourceBucket(skill.source) === bucket).length;
    return [
      {
        id: "all",
        label: t("options.skills.all"),
        description: "",
        count: count("all"),
        icon: Library,
      },
      {
        id: "project",
        label: t("options.skills.dsh.source.project"),
        description: t("options.skills.dsh.source.project.description"),
        count: count("project"),
        icon: FolderGit2,
      },
      {
        id: "user",
        label: t("options.skills.dsh.source.user"),
        description: t("options.skills.dsh.source.user.description"),
        count: count("user"),
        icon: UserRound,
      },
      {
        id: "runtime",
        label: t("options.skills.dsh.source.runtime"),
        description: t("options.skills.dsh.source.runtime.description"),
        count: count("runtime"),
        icon: Cpu,
      },
      {
        id: "bundled",
        label: t("options.skills.dsh.source.bundled"),
        description: t("options.skills.dsh.source.bundled.description"),
        count: count("bundled"),
        icon: PackageOpen,
      },
      {
        id: "custom",
        label: t("options.skills.dsh.source.custom"),
        description: t("options.skills.dsh.source.custom.description"),
        count: count("custom"),
        icon: Blocks,
      },
      {
        id: "other",
        label: t("options.skills.dsh.source.other"),
        description: t("options.skills.dsh.source.other.description"),
        count: count("other"),
        icon: Plug,
      },
    ].filter((item) => item.id === "all" || item.count > 0) as SourceBucketView[];
  }, [skills, t]);

  const sourcePool = useMemo(
    () =>
      source === "all"
        ? skills
        : skills.filter((skill) => sourceBucket(skill.source) === source),
    [skills, source],
  );
  const modelCount = sourcePool.filter((skill) => skill.modelInvocable).length;
  const userCount = sourcePool.filter((skill) => skill.userInvocable).length;
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return sourcePool.filter((skill) => {
      if (invocation.has("model") && !skill.modelInvocable) return false;
      if (invocation.has("user") && !skill.userInvocable) return false;
      return (
        !needle ||
        `${skill.name} ${skill.description} ${skill.whenToUse ?? ""} ${skill.source} ${skill.provider}`
          .toLocaleLowerCase()
          .includes(needle)
      );
    });
  }, [invocation, query, sourcePool]);

  const beginEdit = async (skill: AgentSkillEntry) => {
    setBusy(true);
    setError(null);
    try {
      setEditing(await adapter.read(skill.name, sessionId));
      setViewing(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const save = async (name: string, document: string) => {
    setBusy(true);
    setError(null);
    try {
      await adapter.save(name, document, sessionId);
      setEditing(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (skill: AgentSkillEntry) => {
    if (!confirm(t("options.skills.dsh.deleteConfirm", { name: skill.name }))) return;
    setBusy(true);
    setError(null);
    try {
      await adapter.remove(skill.name, sessionId);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const toggleInvocation = (key: InvocationFilter) =>
    setInvocation((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const grouped = useMemo(
    () =>
      sources
        .filter((item) => item.id !== "all")
        .map((item) => ({
          ...item,
          skills: filtered.filter(
            (skill) => sourceBucket(skill.source) === item.id,
          ),
        }))
        .filter((group) => group.skills.length > 0),
    [filtered, sources],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {!embedded ? (
        <SettingsPageActions host={headerActionsHost}>
          <SettingsPageActionButton type="button" onClick={() => setEditing({})}>
            <Plus />
            {t("options.skills.dsh.create")}
          </SettingsPageActionButton>
        </SettingsPageActions>
      ) : null}
      <ScrollArea className="min-h-0 min-w-0 flex-1">
        <PageContent
          bodyClassName="space-y-4"
          className={!embedded ? "pt-3" : undefined}
          size="md"
        >
          {!embedded ? (
            <SettingsPageDescription>
              {t("options.skills.dsh.description")}
            </SettingsPageDescription>
          ) : null}
          <SkillSourceIndex
            active={source}
            onChange={setSource}
            sources={sources}
          />

          <div className={`${MODEL_SETTINGS_SURFACE_CLASS} p-2.5`}>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-48 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 border-0 bg-muted/35 pl-8 pr-8 text-sm shadow-none focus-visible:ring-1"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("options.skills.dsh.search")}
                  value={query}
                />
                {query ? (
                  <button
                    aria-label={t("options.skills.clearSearch")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted"
                    onClick={() => setQuery("")}
                    type="button"
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
              <span className="hidden text-[11px] text-muted-foreground sm:inline">
                {t("options.skills.dsh.invocation")}
              </span>
              <FilterChip
                active={invocation.has("model")}
                count={modelCount}
                label={t("options.skills.dsh.modelInvocable")}
                onClick={() => toggleInvocation("model")}
              />
              <FilterChip
                active={invocation.has("user")}
                count={userCount}
                label={t("options.skills.dsh.userInvocable")}
                onClick={() => toggleInvocation("user")}
              />
              {invocation.size ? (
                <button
                  className="px-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setInvocation(new Set())}
                  type="button"
                >
                  {t("options.skills.clearFilters")}
                </button>
              ) : null}
            </div>
          </div>

          {error ? (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
              <span>{error}</span>
              <Button
                onClick={() => void refresh()}
                size="sm"
                type="button"
                variant="outline"
              >
                {t("common.retry")}
              </Button>
            </div>
          ) : null}

          {loading && skills.length === 0 ? (
            <div className={MODEL_SETTINGS_SURFACE_CLASS}>
              <CollectionState
                className="min-h-48"
                icon={<Loader2 className="animate-spin" />}
                role="status"
              >
                {t("options.skills.loading")}
              </CollectionState>
            </div>
          ) : filtered.length === 0 ? (
            <div className={MODEL_SETTINGS_SURFACE_CLASS}>
              <CollectionState className="min-h-48" icon={<FileText />}>
                {t("options.skills.noMatches")}
              </CollectionState>
            </div>
          ) : (
            <div className={MODEL_SETTINGS_SURFACE_CLASS}>
              {grouped.map((group) => {
                const Icon = group.icon;
                return (
                  <section
                    className="border-t border-border/60 first:border-t-0"
                    key={group.id}
                  >
                    <div className="flex items-center gap-3 bg-muted/[0.035] px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <h3 className="text-xs font-semibold text-foreground">
                            {group.label}
                          </h3>
                          <p className="text-[11px] text-muted-foreground">
                            {group.description}
                          </p>
                        </div>
                      </div>
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {group.skills.length}
                      </span>
                    </div>
                    <ul className="border-t border-border/45">
                      {group.skills.map((skill) => (
                        <SkillRow
                          busy={busy}
                          icon={Icon}
                          key={skill.name}
                          onEdit={() => void beginEdit(skill)}
                          onRemove={() => void remove(skill)}
                          onView={() => setViewing(skill)}
                          skill={skill}
                        />
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
          {embedded ? (
            <Button size="sm" type="button" onClick={() => setEditing({})}>
              <Plus />
              {t("options.skills.dsh.create")}
            </Button>
          ) : null}
        </PageContent>
      </ScrollArea>
      <SkillViewer adapter={adapter} sessionId={sessionId} skill={viewing} onClose={() => setViewing(null)} onEdit={(skill) => void beginEdit(skill)} />
      <SkillEditor
        open={editing !== null}
        initialName={editing?.name}
        initialDocument={editing?.document}
        busy={busy}
        onOpenChange={(open) => !open && setEditing(null)}
        onSave={save}
      />
    </div>
  );
}

function SkillRow({
  skill,
  icon: Icon,
  busy,
  onView,
  onEdit,
  onRemove,
}: {
  skill: AgentSkillEntry;
  icon: LucideIcon;
  busy: boolean;
  onView(): void;
  onEdit(): void;
  onRemove(): void;
}) {
  const { t } = useT();
  return (
    <li className="flex items-center border-b border-border/40 last:border-b-0">
      <button
        className="group flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/20"
        onClick={onView}
        title={[
          skill.description,
          skill.whenToUse,
          `${skill.source} · ${skill.provider}`,
          resourceLabel(skill),
        ]
          .filter(Boolean)
          .join("\n")}
        type="button"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/55 text-muted-foreground">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{skill.name}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {skill.description || skill.whenToUse || skill.provider}
          </span>
        </span>
        <span className="hidden max-w-36 shrink-0 truncate text-[11px] text-muted-foreground lg:block">
          {skill.provider}
        </span>
        <span className="hidden shrink-0 items-center gap-1 text-[11px] text-muted-foreground sm:flex">
          {skill.modelInvocable ? (
            <span className="rounded bg-muted/65 px-1.5 py-0.5">
              {t("options.skills.dsh.modelInvocable")}
            </span>
          ) : null}
          {skill.userInvocable ? (
            <span className="rounded bg-muted/65 px-1.5 py-0.5">
              {t("options.skills.dsh.userInvocable")}
            </span>
          ) : null}
          {!skill.modelInvocable && !skill.userInvocable ? (
            <span className="rounded bg-muted/65 px-1.5 py-0.5">
              {t("options.skills.dsh.notInvocable")}
            </span>
          ) : null}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
      </button>
      {skill.editable ? (
        <div className="flex shrink-0 items-center gap-0.5 pr-2">
          <Button
            disabled={busy}
            onClick={onEdit}
            size="icon"
            title={t("options.skills.dsh.edit")}
            variant="ghost"
          >
            <Pencil />
          </Button>
          <Button
            className="text-destructive hover:text-destructive"
            disabled={busy}
            onClick={onRemove}
            size="icon"
            title={t("common.delete")}
            variant="ghost"
          >
            <Trash2 />
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function SkillSourceIndex({
  active,
  sources,
  onChange,
}: {
  active: SourceBucket;
  sources: SourceBucketView[];
  onChange(source: SourceBucket): void;
}) {
  const { t } = useT();
  return (
    <div className={`${MODEL_SETTINGS_SURFACE_CLASS} overflow-x-auto p-1.5`}>
      <div
        aria-label={t("options.skills.dsh.sources")}
        className="flex min-w-max items-center gap-1"
        role="group"
      >
        {sources.map((entry) => {
          const Icon = entry.icon;
          const selected = active === entry.id;
          return (
            <button
              aria-pressed={selected}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                selected
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/45 hover:text-foreground",
              )}
              key={entry.id}
              onClick={() => onChange(entry.id)}
              type="button"
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{entry.label}</span>
              <span
                className={cn(
                  "min-w-5 rounded px-1.5 py-0.5 text-center text-[10px] tabular-nums",
                  selected ? "bg-background/75" : "bg-muted/55",
                )}
              >
                {entry.count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/45 hover:text-foreground",
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums opacity-65">{count}</span>
    </button>
  );
}
