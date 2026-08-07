import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Badge,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  ScrollArea,
  Switch,
} from "../primitives";

import { useRefetchOnFocus } from "../hooks/useRefetchOnFocus";
import {
  getHermesSkills,
  getHermesSkillFiles,
  getHermesSkillFile,
  postHermesSkillToggle,
} from "@amiba/core";
import { useT, type MessageKey } from "@amiba/i18n";
import type {
  HermesSkillEntry,
  HermesSkillFileEntry,
  HermesSkillFileResponse,
  HermesSkillsResponse,
  HermesSkillOrigin,
} from "@amiba/core";

const ALL_KEY = "__all__";
const UNCATEGORIZED_KEY = "__uncategorized__";

interface OriginInfo {
  labelKey: MessageKey;
  tooltipKey: MessageKey;
  className: string;
}

const ORIGIN_INFO: Record<string, OriginInfo> = {
  bundled: {
    labelKey: "options.skills.origin.bundled",
    tooltipKey: "options.skills.origin.bundledHint",
    className: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  },
  hub: {
    labelKey: "options.skills.origin.hub",
    tooltipKey: "options.skills.origin.hubHint",
    className: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  },
  agent: {
    labelKey: "options.skills.origin.agent",
    tooltipKey: "options.skills.origin.agentHint",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  manual: {
    labelKey: "options.skills.origin.manual",
    tooltipKey: "options.skills.origin.manualHint",
    className: "bg-muted text-muted-foreground",
  },
  external: {
    labelKey: "options.skills.origin.external",
    tooltipKey: "options.skills.origin.externalHint",
    className: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  },
};

function originMeta(
  origin: HermesSkillOrigin,
  t: ReturnType<typeof useT>["t"],
): { label: string; tooltip: string; className: string } {
  const meta = ORIGIN_INFO[origin];
  if (!meta) {
    return {
      label: origin,
      tooltip: origin,
      className: "bg-muted text-muted-foreground",
    };
  }
  return {
    label: t(meta.labelKey),
    tooltip: t(meta.tooltipKey),
    className: meta.className,
  };
}

const ORIGIN_FILTER_ORDER: HermesSkillOrigin[] = [
  "bundled",
  "hub",
  "agent",
  "manual",
  "external",
];

type EnabledBucket = "enabled" | "disabled";

const ENABLED_INFO: Record<
  EnabledBucket,
  { labelKey: MessageKey; tooltipKey: MessageKey; className: string }
> = {
  enabled: {
    labelKey: "options.skills.enabled",
    tooltipKey: "options.skills.enabledHint",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
  disabled: {
    labelKey: "options.skills.disabled",
    tooltipKey: "options.skills.disabledHint",
    className: "bg-muted text-muted-foreground",
  },
};

const ENABLED_FILTER_ORDER: EnabledBucket[] = ["enabled", "disabled"];

interface CategoryBucket {
  key: string;
  label: string;
  count: number;
  enabledCount: number;
}

function formatRelative(iso: string | null, language: string): string {
  if (!iso) return "";
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return "";
  const elapsed = timestamp - Date.now();
  const absoluteSeconds = Math.abs(elapsed / 1000);
  const formatter = new Intl.RelativeTimeFormat(language, {
    numeric: "auto",
  });
  if (absoluteSeconds < 60)
    return formatter.format(Math.round(elapsed / 1000), "second");
  if (absoluteSeconds < 3600)
    return formatter.format(Math.round(elapsed / 60000), "minute");
  if (absoluteSeconds < 86400)
    return formatter.format(Math.round(elapsed / 3600000), "hour");
  if (absoluteSeconds < 86400 * 30)
    return formatter.format(Math.round(elapsed / 86400000), "day");
  if (absoluteSeconds < 86400 * 365)
    return formatter.format(Math.round(elapsed / (86400000 * 30)), "month");
  return formatter.format(Math.round(elapsed / (86400000 * 365)), "year");
}

function formatAbsolute(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

const TS_SOURCE_LABEL: Record<string, string> = {
  usage: "Usage record",
  hub: "Hub install record",
  fs: "Filesystem time",
};

function SkillRow({
  skill,
  onView,
  onToggle,
  toggling,
}: {
  skill: HermesSkillEntry;
  onView: (skill: HermesSkillEntry) => void;
  onToggle: (skill: HermesSkillEntry, next: boolean) => void;
  toggling: boolean;
}) {
  const { t, language } = useT();
  const origin = originMeta(skill.origin, t);
  const muted = !skill.enabled;

  const updatedRel = formatRelative(skill.updated_at, language);

  const hoverParts: string[] = [];
  if (skill.description) hoverParts.push(skill.description);
  if (skill.platforms?.length)
    hoverParts.push(`platforms: ${skill.platforms.join(", ")}`);
  if (skill.tags.length) hoverParts.push(`tags: ${skill.tags.join(", ")}`);
  hoverParts.push(`Added: ${formatAbsolute(skill.created_at)}`);
  hoverParts.push(`Updated: ${formatAbsolute(skill.updated_at)}`);
  hoverParts.push(
    `Source: ${TS_SOURCE_LABEL[skill.timestamp_source] ?? skill.timestamp_source}`,
  );
  hoverParts.push("Click the row to browse files");
  const hoverTitle = hoverParts.join("\n");

  const toggleLabel = skill.enabled
    ? t("options.skills.enabled")
    : t("options.skills.disabled");
  const toggleTooltip = skill.enabled
    ? t("options.skills.toggleOn")
    : t("options.skills.toggleOff");

  return (
    <li
      title={hoverTitle || undefined}
      onClick={() => onView(skill)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onView(skill);
        }
      }}
      role="button"
      tabIndex={0}
      className={cn(
        "flex cursor-pointer items-start gap-3 border-b border-border/40 px-2 py-2 transition-colors last:border-b-0 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none",
        muted && "opacity-60",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-sm font-normal tracking-tight">
            {skill.name}
          </span>
          {skill.version && (
            <span className="shrink-0 text-xs font-normal text-muted-foreground/80">
              v{skill.version}
            </span>
          )}
        </div>
        <div className="flex min-w-0 items-baseline gap-2">
          {skill.description ? (
            <p className="line-clamp-2 min-w-0 flex-1 text-xs leading-snug text-muted-foreground">
              {skill.description}
            </p>
          ) : (
            <span className="flex-1" />
          )}
          {updatedRel && (
            <span
              className="shrink-0 text-xs tabular-nums text-muted-foreground/70"
              title={`Updated ${formatAbsolute(skill.updated_at)}`}
            >
              {updatedRel}
            </span>
          )}
        </div>
      </div>
      <span
        className={cn(
          "mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium",
          origin.className,
        )}
        title={origin.tooltip}
      >
        {origin.label}
      </span>
      <div
        className="mt-0.5 flex shrink-0 items-center gap-2"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        title={toggleTooltip}
      >
        <span className="text-[11px] text-muted-foreground">
          {toggleLabel}
        </span>
        <Switch
          aria-label={toggleTooltip}
          checked={skill.enabled}
          disabled={toggling}
          onCheckedChange={(next) => onToggle(skill, next)}
        />
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Skill directory viewer dialog.
//
// Two panes: file list (sorted, with SKILL.md pinned to the top) and the
// selected file's body. Auto-selects SKILL.md on open so the user lands on
// the canonical entry point instead of an empty right pane.
// ---------------------------------------------------------------------------

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

interface SkillTreeNode {
  /** Last path segment — what we render. */
  name: string;
  /** Full path from the skill root. For dirs: `"references"`, `"a/b"`. */
  path: string;
  isDir: boolean;
  /** Bytes (files only). */
  size?: number;
  /** Populated for dirs; undefined for files. */
  children?: SkillTreeNode[];
}

/**
 * Build a directory tree from a flat list of file paths. At each level
 * the order is: `SKILL.md` first (root only), then dirs before files,
 * then alphabetical — matches VS Code's file explorer convention.
 */
function buildSkillTree(files: HermesSkillFileEntry[]): SkillTreeNode[] {
  const root: SkillTreeNode = { name: "", path: "", isDir: true, children: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const segment = parts[i];
      const isLast = i === parts.length - 1;
      if (isLast) {
        cur.children!.push({
          name: segment,
          path: f.path,
          isDir: false,
          size: f.size,
        });
      } else {
        let dir = cur.children!.find((c) => c.isDir && c.name === segment);
        if (!dir) {
          dir = {
            name: segment,
            path: parts.slice(0, i + 1).join("/"),
            isDir: true,
            children: [],
          };
          cur.children!.push(dir);
        }
        cur = dir;
      }
    }
  }
  function sortChildren(node: SkillTreeNode, isRoot: boolean): void {
    if (!node.children) return;
    node.children.sort((a, b) => {
      if (isRoot) {
        if (a.path === "SKILL.md") return -1;
        if (b.path === "SKILL.md") return 1;
      }
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const c of node.children) sortChildren(c, false);
  }
  sortChildren(root, true);
  return root.children!;
}

/** Walk the tree and collect every directory's full path. */
function collectSkillTreeDirs(nodes: SkillTreeNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (n.isDir) {
      out.push(n.path);
      if (n.children) out.push(...collectSkillTreeDirs(n.children));
    }
  }
  return out;
}

interface FlatSkillTreeRow {
  node: SkillTreeNode;
  depth: number;
}

/**
 * Flatten the tree into the visible row sequence given the current set
 * of expanded dir paths — collapsed dirs hide their descendants.
 */
function flattenSkillTree(
  nodes: SkillTreeNode[],
  expanded: Set<string>,
  depth = 0,
): FlatSkillTreeRow[] {
  const out: FlatSkillTreeRow[] = [];
  for (const n of nodes) {
    out.push({ node: n, depth });
    if (n.isDir && n.children && expanded.has(n.path)) {
      out.push(...flattenSkillTree(n.children, expanded, depth + 1));
    }
  }
  return out;
}

interface SkillViewerDialogProps {
  skill: HermesSkillEntry | null;
  profileId?: string;
  onClose: () => void;
}

function SkillViewerDialog({
  skill,
  profileId,
  onClose,
}: SkillViewerDialogProps) {
  const { t } = useT();
  const [files, setFiles] = useState<HermesSkillFileEntry[]>([]);
  const [root, setRoot] = useState<string>("");
  const [truncated, setTruncated] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileBody, setFileBody] = useState<HermesSkillFileResponse | null>(
    null,
  );
  const [loadingFile, setLoadingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  /**
   * Per-dir expansion state. We seed it from the freshly-loaded tree so
   * that opening a skill shows every file inline (matches the old flat
   * behaviour); users can then collapse subtrees as needed.
   */
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(
    () => new Set(),
  );

  const open = !!skill;

  // Load the file list whenever a new skill is opened. Reset everything so
  // re-opening a different skill doesn't show the previous skill's body in
  // the right pane while the new list is in flight.
  useEffect(() => {
    if (!skill) return;
    setFiles([]);
    setRoot("");
    setTruncated(false);
    setListError(null);
    setSelectedPath(null);
    setFileBody(null);
    setFileError(null);
    setExpandedDirs(new Set());
    setLoadingList(true);
    let cancelled = false;
    void (async () => {
      const r = await getHermesSkillFiles(skill.name, profileId);
      if (cancelled) return;
      setLoadingList(false);
      if (!r.ok) {
        setListError(r.error || t("options.skills.loadFailed"));
        return;
      }
      setFiles(r.files);
      setRoot(r.root || "");
      setTruncated(!!r.truncated);
      const tree = buildSkillTree(r.files);
      setExpandedDirs(new Set(collectSkillTreeDirs(tree)));
      // Auto-select the canonical entry file (SKILL.md) when present so
      // the right pane has something to show immediately; otherwise pick
      // the first file in tree order.
      const skillMd = r.files.find((f) => f.path === "SKILL.md");
      const firstFile = skillMd ?? r.files[0];
      if (firstFile) setSelectedPath(firstFile.path);
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, skill, t]);

  const tree = useMemo(() => buildSkillTree(files), [files]);
  const flatRows = useMemo(
    () => flattenSkillTree(tree, expandedDirs),
    [tree, expandedDirs],
  );

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Fetch the selected file's body. Encoding metadata flows straight from
  // the bridge — utf-8 renders inline; binary / too-large render a
  // placeholder instead so we never try to display garbage.
  useEffect(() => {
    if (!skill || !selectedPath) {
      setFileBody(null);
      return;
    }
    setLoadingFile(true);
    setFileError(null);
    let cancelled = false;
    void (async () => {
      const r = await getHermesSkillFile(skill.name, selectedPath, profileId);
      if (cancelled) return;
      setLoadingFile(false);
      if (!r.ok) {
        setFileError(r.error || t("options.skills.loadFailed"));
        setFileBody(null);
        return;
      }
      setFileBody(r);
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, skill, selectedPath, t]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className={cn("flex h-[80vh] max-h-[800px] flex-col gap-0 p-0")}
        size="full"
      >
        <DialogHeader className="border-b border-border bg-muted/30 px-4 py-3">
          <DialogTitle className="text-sm font-semibold">
            {skill?.name ?? ""}
            {skill?.version && (
              <span className="ml-2 text-xs font-normal text-muted-foreground/80">
                v{skill.version}
              </span>
            )}
          </DialogTitle>
          <DialogDescription
            className="truncate text-xs text-muted-foreground"
            title={root}
          >
            {root || skill?.path}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          {/* ── File list ── */}
          <aside className="flex min-h-0 w-64 shrink-0 flex-col border-r border-border bg-muted/15">
            <div className="border-b border-border/50 px-3 py-1.5 text-xs uppercase tracking-wider text-muted-foreground/70">
              {t("options.skills.files", { count: files.length })}
              {truncated && (
                <span className="ml-1 text-amber-600 dark:text-amber-400">
                  ·{" "}
                  {t("options.skills.filesTruncated", {
                    count: files.length,
                  })}
                </span>
              )}
            </div>
            <ScrollArea className="min-h-0 flex-1">
              {loadingList ? (
                <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  {t("options.skills.loading")}
                </div>
              ) : listError ? (
                <p className="px-3 py-3 text-xs text-destructive">
                  {listError}
                </p>
              ) : files.length === 0 ? (
                <p className="px-3 py-3 text-xs text-muted-foreground">
                  {t("options.skills.noFiles")}
                </p>
              ) : (
                <ul className="flex flex-col py-1">
                  {flatRows.map(({ node, depth }) => {
                    // 8px base + 12px per nesting level — gives the
                    // chevron/file-icon column a consistent left edge
                    // per depth, the same trick VS Code's explorer uses.
                    const indentPx = 8 + depth * 12;
                    if (node.isDir) {
                      const expanded = expandedDirs.has(node.path);
                      return (
                        <li key={`d:${node.path}`}>
                          <button
                            type="button"
                            onClick={() => toggleDir(node.path)}
                            title={node.path}
                            className="flex w-full items-center gap-1 py-1 pr-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                            style={{ paddingLeft: indentPx }}
                            aria-expanded={expanded}
                          >
                            {expanded ? (
                              <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
                            ) : (
                              <ChevronRight className="h-3 w-3 shrink-0 opacity-70" />
                            )}
                            {expanded ? (
                              <FolderOpen className="h-3 w-3 shrink-0 opacity-70" />
                            ) : (
                              <Folder className="h-3 w-3 shrink-0 opacity-70" />
                            )}
                            <span className="min-w-0 flex-1 truncate font-mono">
                              {node.name}
                            </span>
                          </button>
                        </li>
                      );
                    }
                    const isSel = node.path === selectedPath;
                    return (
                      <li key={`f:${node.path}`}>
                        <button
                          type="button"
                          onClick={() => setSelectedPath(node.path)}
                          title={`${node.path} · ${formatFileSize(node.size ?? 0)}`}
                          className={cn(
                            "flex w-full items-center gap-1 py-1 pr-3 text-left text-sm transition-colors",
                            isSel
                              ? "bg-muted text-foreground"
                              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                          )}
                          // Files skip the chevron column so their
                          // FileText icon lines up with the folder icon
                          // of a dir at the same depth (chevron 12px +
                          // gap-1 4px = 16px).
                          style={{ paddingLeft: indentPx + 16 }}
                        >
                          <FileText className="h-3 w-3 shrink-0 opacity-70" />
                          <span className="min-w-0 flex-1 truncate font-mono">
                            {node.name}
                          </span>
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

          {/* ── File body ── */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-border/50 bg-muted/10 px-3 py-1.5 text-xs">
              <span className="truncate font-mono text-muted-foreground">
                {selectedPath || "—"}
              </span>
              {fileBody?.size != null && (
                <span className="ml-2 shrink-0 tabular-nums text-muted-foreground/70">
                  {formatFileSize(fileBody.size)}
                </span>
              )}
            </div>
            <ScrollArea className="min-h-0 flex-1 bg-background">
              {loadingFile ? (
                <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  {t("options.skills.reading")}
                </div>
              ) : fileError ? (
                <p className="px-4 py-3 text-xs text-destructive">
                  {fileError}
                </p>
              ) : fileBody?.encoding === "binary" ? (
                <p className="px-4 py-3 text-xs text-muted-foreground">
                  {t("options.skills.binaryFile", {
                    size: formatFileSize(fileBody.size ?? 0),
                  })}
                </p>
              ) : fileBody?.encoding === "too-large" ? (
                <p className="px-4 py-3 text-xs text-muted-foreground">
                  {t("options.skills.fileTooLarge", {
                    size: formatFileSize(fileBody.size ?? 0),
                  })}
                </p>
              ) : fileBody?.content != null ? (
                <pre
                  data-selection="text"
                  className="whitespace-pre-wrap break-words px-4 py-3 font-mono text-xs leading-relaxed"
                >
                  {fileBody.content}
                </pre>
              ) : (
                <p className="px-4 py-3 text-xs text-muted-foreground">
                  {t("options.skills.selectFile")}
                </p>
              )}
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function buildCategoryBuckets(
  skills: HermesSkillEntry[],
  uncategorizedLabel: string,
): CategoryBucket[] {
  const map = new Map<string, { count: number; enabledCount: number }>();
  for (const s of skills) {
    const key = s.category ?? UNCATEGORIZED_KEY;
    const cur = map.get(key) ?? { count: 0, enabledCount: 0 };
    cur.count += 1;
    if (s.enabled) cur.enabledCount += 1;
    map.set(key, cur);
  }
  const keys = Array.from(map.keys()).sort((a, b) => {
    if (a === UNCATEGORIZED_KEY) return 1;
    if (b === UNCATEGORIZED_KEY) return -1;
    return a.localeCompare(b);
  });
  return keys.map((k) => ({
    key: k,
    label: k === UNCATEGORIZED_KEY ? uncategorizedLabel : k,
    count: map.get(k)!.count,
    enabledCount: map.get(k)!.enabledCount,
  }));
}

const EMPTY_RESPONSE: HermesSkillsResponse = {
  ok: true,
  skills: [],
  platform: "",
  sys_platform: "",
  skills_dirs: [],
  totals: { total: 0, enabled: 0, disabled: 0 },
  origin_counts: {},
};

/** Skills available to the selected Hermes profile. */
export function SkillsPage({
  profileId,
  embedded = false,
}: {
  profileId?: string;
  embedded?: boolean;
} = {}) {
  const { t } = useT();
  const [data, setData] = useState<HermesSkillsResponse>(EMPTY_RESPONSE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(ALL_KEY);
  const [originFilter, setOriginFilter] = useState<Set<HermesSkillOrigin>>(
    () => new Set(),
  );
  const [enabledFilter, setEnabledFilter] = useState<Set<EnabledBucket>>(
    () => new Set(),
  );
  const [viewingSkill, setViewingSkill] = useState<HermesSkillEntry | null>(
    null,
  );
  /**
   * Tracks which skills currently have an in-flight toggle POST. Per-row
   * keys so simultaneous toggles on different rows each show their own
   * pending state without blocking other rows.
   */
  const [togglingNames, setTogglingNames] = useState<Set<string>>(
    () => new Set(),
  );
  const [toggleError, setToggleError] = useState<string | null>(null);

  const toggleOrigin = useCallback((o: HermesSkillOrigin) => {
    setOriginFilter((prev) => {
      const next = new Set(prev);
      if (next.has(o)) next.delete(o);
      else next.add(o);
      return next;
    });
  }, []);

  const toggleEnabled = useCallback((b: EnabledBucket) => {
    setEnabledFilter((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await getHermesSkills(profileId);
    setLoading(false);
    if (!r.ok) {
      setError(r.error || t("options.skills.loadFailed"));
      setData(EMPTY_RESPONSE);
      return;
    }
    setData(r);
  }, [profileId, t]);

  /**
   * Optimistic toggle: flip the `enabled` flag locally first, fire the
   * POST, and revert if the server rejects. Errors surface in a small
   * banner instead of a modal so the user can keep toggling other rows.
   */
  const handleToggle = useCallback(
    async (skill: HermesSkillEntry, next: boolean) => {
      const name = skill.name;
      setToggleError(null);
      setTogglingNames((prev) => {
        const out = new Set(prev);
        out.add(name);
        return out;
      });
      // Optimistic update.
      setData((prev) => ({
        ...prev,
        skills: prev.skills.map((s) =>
          s.name === name ? { ...s, enabled: next } : s,
        ),
        totals: {
          ...prev.totals,
          enabled: prev.totals.enabled + (next ? 1 : -1),
          disabled: prev.totals.disabled + (next ? -1 : 1),
        },
      }));
      const r = await postHermesSkillToggle(name, next, profileId);
      setTogglingNames((prev) => {
        const out = new Set(prev);
        out.delete(name);
        return out;
      });
      if (!r.ok) {
        // Revert.
        setData((prev) => ({
          ...prev,
          skills: prev.skills.map((s) =>
            s.name === name ? { ...s, enabled: !next } : s,
          ),
          totals: {
            ...prev.totals,
            enabled: prev.totals.enabled + (next ? -1 : 1),
            disabled: prev.totals.disabled + (next ? 1 : -1),
          },
        }));
        setToggleError(
          `${name}: ${r.error || t("options.skills.toggleFailed")}`,
        );
      }
    },
    [profileId, t],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Skills change out-of-band (the agent installs/authors them mid-
  // session), so refetch whenever the user comes back to the window.
  useRefetchOnFocus(() => void refresh());

  const buckets = useMemo(
    () => buildCategoryBuckets(data.skills, t("options.skills.uncategorized")),
    [data.skills, t],
  );

  // Facet base: category-filtered only. Origin/active chip counts come from
  // here so chips don't disappear or jitter as the user toggles facets on
  // each other. The final `filtered` applies all facets + the text query.
  const categoryPool = useMemo(() => {
    if (category === ALL_KEY) return data.skills;
    return data.skills.filter(
      (s) => (s.category ?? UNCATEGORIZED_KEY) === category,
    );
  }, [data.skills, category]);

  const originCounts = useMemo(() => {
    const out: Partial<Record<HermesSkillOrigin, number>> = {};
    for (const s of categoryPool) {
      out[s.origin] = (out[s.origin] ?? 0) + 1;
    }
    return out;
  }, [categoryPool]);

  const enabledCounts = useMemo(() => {
    let on = 0;
    let off = 0;
    for (const s of categoryPool) {
      if (s.enabled) on += 1;
      else off += 1;
    }
    return { enabled: on, disabled: off } as Record<EnabledBucket, number>;
  }, [categoryPool]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return categoryPool.filter((s) => {
      if (originFilter.size > 0 && !originFilter.has(s.origin)) return false;
      if (enabledFilter.size > 0) {
        const bucket: EnabledBucket = s.enabled ? "enabled" : "disabled";
        if (!enabledFilter.has(bucket)) return false;
      }
      if (!q) return true;
      if (s.name.toLowerCase().includes(q)) return true;
      if (s.description.toLowerCase().includes(q)) return true;
      if (s.category && s.category.toLowerCase().includes(q)) return true;
      if (s.tags.some((tag) => tag.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [categoryPool, query, originFilter, enabledFilter]);

  const visibleOrigins = useMemo(
    () => ORIGIN_FILTER_ORDER.filter((o) => (originCounts[o] ?? 0) > 0),
    [originCounts],
  );

  const visibleEnableds = useMemo(
    () => ENABLED_FILTER_ORDER.filter((b) => enabledCounts[b] > 0),
    [enabledCounts],
  );

  const hasAnyChipFilter = originFilter.size + enabledFilter.size > 0;

  const currentBucket = useMemo(
    () => buckets.find((b) => b.key === category),
    [buckets, category],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {/* No page chrome: the sidebar row already names the view, and
          freshness is app-guaranteed (load on mount + refetch on window
          focus), so there is neither a title bar nor a refresh button. */}
      <div className="flex min-h-0 flex-1">
        {/* ── Category sidebar ── */}
        {!embedded ? (
          <aside className="flex min-h-0 w-56 shrink-0 flex-col border-r border-border bg-muted/15">
            {/* "All" entry stays outside the ScrollArea so its w-full reliably
              expands the aside to its declared width even before data lands —
              Radix ScrollArea's viewport wraps children in display:table,
              which breaks width inheritance during the loading state. */}
            <div className="border-b border-border/50">
              <CategoryButton
                active={category === ALL_KEY}
                label={t("options.skills.all")}
                count={data.totals.total}
                enabledCount={data.totals.enabled}
                onClick={() => setCategory(ALL_KEY)}
              />
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <nav className="flex flex-col">
                {buckets.length > 0 && (
                  <p className="px-3 pb-1 pt-2 text-sm font-normal text-muted-foreground">
                    {t("options.skills.categories")}
                  </p>
                )}
                {buckets.map((b) => (
                  <CategoryButton
                    key={b.key}
                    active={category === b.key}
                    label={b.label}
                    count={b.count}
                    enabledCount={b.enabledCount}
                    onClick={() => setCategory(b.key)}
                  />
                ))}
              </nav>
            </ScrollArea>
          </aside>
        ) : null}

        {/* ── Right panel ── */}
        <ScrollArea className="min-h-0 min-w-0 flex-1">
          <div className={cn("space-y-4 p-6", embedded && "pt-3")}>
            {error && <p className="text-xs text-destructive">{error}</p>}
            {toggleError && (
              <div className="flex items-start justify-between gap-2 rounded border border-destructive/30 bg-destructive/5 px-2 py-1 text-xs text-destructive">
                <span className="min-w-0 flex-1 break-words">
                  {toggleError}
                </span>
                <button
                  type="button"
                  onClick={() => setToggleError(null)}
                  className="shrink-0 rounded p-0.5 hover:bg-destructive/10"
                  aria-label={t("options.skills.dismissError")}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold tracking-tight">
                  {category === ALL_KEY
                    ? t("options.skills.all")
                    : (currentBucket?.label ?? category)}
                </h3>
                <p
                  className="text-xs text-muted-foreground"
                  title={data.skills_dirs.join("\n") || "$HERMES_HOME/skills"}
                >
                  {t("options.skills.totalEnabled", {
                    total: currentBucket?.count ?? data.totals.total,
                    enabled: currentBucket?.enabledCount ?? data.totals.enabled,
                  })}
                </p>
              </div>
            </div>

            {embedded && buckets.length > 0 ? (
              <div
                aria-label={t("options.skills.categories")}
                className="flex gap-1.5 overflow-x-auto pb-0.5"
              >
                {[
                  {
                    key: ALL_KEY,
                    label: t("options.skills.all"),
                    count: data.totals.total,
                  },
                  ...buckets,
                ].map((bucket) => {
                  const active = category === bucket.key;
                  return (
                    <button
                      className={cn(
                        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] transition-colors",
                        active
                          ? "border-foreground/15 bg-foreground text-background"
                          : "border-border/65 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                      key={bucket.key}
                      onClick={() => setCategory(bucket.key)}
                      type="button"
                    >
                      <span>{bucket.label}</span>
                      <span className="tabular-nums opacity-65">
                        {bucket.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("options.skills.search")}
                className="h-8 pl-7 pr-7 text-sm"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={t("options.skills.clearSearch")}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {(visibleEnableds.length > 0 || visibleOrigins.length > 0) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {visibleEnableds.map((b) => {
                  const meta = ENABLED_INFO[b];
                  const on = enabledFilter.has(b);
                  const count = enabledCounts[b];
                  return (
                    <button
                      key={b}
                      type="button"
                      onClick={() => toggleEnabled(b)}
                      title={t(meta.tooltipKey)}
                      className={cn(
                        "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
                        on
                          ? `${meta.className} border-current`
                          : "border-border text-muted-foreground hover:bg-muted",
                      )}
                    >
                      <span>{t(meta.labelKey)}</span>
                      <span className="tabular-nums opacity-70">{count}</span>
                    </button>
                  );
                })}
                {visibleEnableds.length > 0 && visibleOrigins.length > 0 && (
                  <span className="mx-0.5 text-muted-foreground/50">·</span>
                )}
                {visibleOrigins.map((o) => {
                  const meta = originMeta(o, t);
                  const on = originFilter.has(o);
                  const count = originCounts[o] ?? 0;
                  return (
                    <button
                      key={o}
                      type="button"
                      onClick={() => toggleOrigin(o)}
                      title={meta.tooltip}
                      className={cn(
                        "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
                        on
                          ? `${meta.className} border-current`
                          : "border-border text-muted-foreground hover:bg-muted",
                      )}
                    >
                      <span>{meta.label}</span>
                      <span className="tabular-nums opacity-70">{count}</span>
                    </button>
                  );
                })}
                {hasAnyChipFilter && (
                  <button
                    type="button"
                    onClick={() => {
                      setOriginFilter(new Set());
                      setEnabledFilter(new Set());
                    }}
                    className="rounded-full px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {t("options.skills.clearFilters")}
                  </button>
                )}
              </div>
            )}

            {filtered.length === 0 && !loading && !error ? (
              <p className="text-xs text-muted-foreground">
                {t("options.skills.noMatches")}
              </p>
            ) : (
              <ul className="overflow-hidden rounded-xl border border-border/60">
                {filtered.map((s) => (
                  <SkillRow
                    key={`${s.category ?? ""}/${s.name}`}
                    skill={s}
                    onView={setViewingSkill}
                    onToggle={handleToggle}
                    toggling={togglingNames.has(s.name)}
                  />
                ))}
              </ul>
            )}
          </div>
        </ScrollArea>
      </div>
      <SkillViewerDialog
        profileId={profileId}
        skill={viewingSkill}
        onClose={() => setViewingSkill(null)}
      />
    </div>
  );
}

function CategoryButton({
  active,
  label,
  count,
  enabledCount,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  enabledCount: number;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        "h-auto min-h-0 w-full flex-row items-center justify-between gap-2 rounded-none border-0 px-3 py-2 text-left font-normal shadow-none",
        active
          ? "bg-muted text-foreground hover:bg-muted"
          : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
      )}
      onClick={onClick}
    >
      <span className="truncate text-sm font-normal">{label}</span>
      <Badge
        variant="outline"
        className="h-4 shrink-0 px-1 text-xs leading-none tabular-nums"
        title={`${enabledCount} enabled / ${count} total`}
      >
        {count}
      </Badge>
    </Button>
  );
}
