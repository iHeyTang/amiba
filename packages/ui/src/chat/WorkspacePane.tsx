import { defaultKeymap } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import {
  getHermesKanbanTasks,
  type HermesKanbanTask,
  type HermesToolProgress,
} from "@amiba/core";
import { useT } from "@amiba/i18n";
import {
  getPlatform,
  type WorkspaceFileDocument,
  type WorkspaceFilesAdapter,
} from "@amiba/platform";
import {
  Atom,
  Braces,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Code2,
  CodeXml,
  Copy,
  ExternalLink,
  FileCode2,
  FileDiff,
  FileText,
  FolderOpen,
  GitBranch,
  Hash,
  MoreHorizontal,
  PanelRight,
  RotateCw,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { tags } from "@lezer/highlight";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  cn,
} from "../primitives";
import type { WorkspaceInspectorCapability } from "./internal/capabilities";
import { formatToolDuration } from "./internal/helpers";
import { KanbanStatusBadge } from "./KanbanStatusBadge";
import {
  compactWorkspacePath,
  parseWorkspaceReview,
  workspaceTabLabel,
  type WorkspaceReviewEntry,
  type WorkspaceReviewFile,
  type WorkspaceReviewGap,
  type WorkspaceReviewLine,
} from "./workspace-review";

const PANE_OPEN_KEY = "settings.chat.workspacePaneOpen";
const PANE_WIDTH_KEY = "settings.chat.workspacePaneWidth";
const DEFAULT_PANE_WIDTH = 520;
const MIN_PANE_WIDTH = 360;
const MAX_PANE_WIDTH = 880;

const WORKSPACE_CODE_HIGHLIGHT = HighlightStyle.define([
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    class: "cm-syntax-comment",
  },
  {
    tag: [tags.keyword, tags.modifier, tags.operatorKeyword],
    class: "cm-syntax-keyword",
  },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp],
    class: "cm-syntax-string",
  },
  {
    tag: [tags.number, tags.bool, tags.null],
    class: "cm-syntax-number",
  },
  {
    tag: [
      tags.typeName,
      tags.className,
      tags.namespace,
      tags.definition(tags.typeName),
    ],
    class: "cm-syntax-type",
  },
  {
    tag: [tags.function(tags.variableName), tags.definition(tags.variableName)],
    class: "cm-syntax-function",
  },
  {
    tag: [tags.propertyName, tags.attributeName],
    class: "cm-syntax-property",
  },
  { tag: tags.operator, class: "cm-syntax-operator" },
]);

type FileResource = {
  kind: "file";
  path: string;
  line?: number;
  sourceToolCallId?: string;
};

type DiffResource = {
  kind: "diff";
  reviewId: string;
  scope: "turn" | "tool";
  entries: WorkspaceReviewEntry[];
};

export type CodeExecutionResource = {
  kind: "code";
  toolCallId: string;
  language: string;
  code: string;
  output: string;
  workdir: string;
  exitCode: number | null;
  failed: boolean;
  status: HermesToolProgress["status"];
  durationMs?: number;
};

export type WorkspacePaneResource =
  | FileResource
  | DiffResource
  | CodeExecutionResource;

interface WorkspacePaneTab {
  id: string;
  resource: WorkspacePaneResource;
  pinned: boolean;
}

interface SessionPaneState {
  tabs: WorkspacePaneTab[];
  activeTabId: string | null;
}

interface WorkspacePaneContextValue {
  enabled: boolean;
  open: boolean;
  width: number;
  tabs: WorkspacePaneTab[];
  activeTab: WorkspacePaneTab | null;
  sessionId: string;
  files?: WorkspaceFilesAdapter;
  setOpen(open: boolean): void;
  toggle(): void;
  setWidth(width: number): void;
  selectTab(id: string): void;
  closeTab(id: string): void;
  openFile(path: string, line?: number): void;
  beginTurn(): void;
  canOpenToolEvent(event: HermesToolProgress): boolean;
  openToolEvent(event: HermesToolProgress): void;
  observeToolEvent(event: HermesToolProgress): void;
}

const EMPTY_CONTEXT: WorkspacePaneContextValue = {
  enabled: false,
  open: false,
  width: DEFAULT_PANE_WIDTH,
  tabs: [],
  activeTab: null,
  sessionId: "",
  setOpen: () => {},
  toggle: () => {},
  setWidth: () => {},
  selectTab: () => {},
  closeTab: () => {},
  openFile: () => {},
  beginTurn: () => {},
  canOpenToolEvent: () => false,
  openToolEvent: () => {},
  observeToolEvent: () => {},
};

const WorkspacePaneContext =
  createContext<WorkspacePaneContextValue>(EMPTY_CONTEXT);

function recordOf(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function decodeResult(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function firstString(
  record: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function workspaceFileTargets(event: HermesToolProgress): string[] {
  const args = event.args ?? {};
  const result = recordOf(decodeResult(event.result));
  const targets: string[] = [];
  const add = (value: unknown) => {
    if (typeof value !== "string" || !value.trim()) return;
    if (!targets.includes(value.trim())) targets.push(value.trim());
  };

  if (result) {
    add(result.resolved_path);
    if (Array.isArray(result.files_modified)) {
      for (const path of result.files_modified) add(path);
    }
    add(result.path);
  }
  add(firstString(args, "path", "file", "filepath"));
  return targets;
}

function stringField(
  record: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    if (typeof record[key] === "string" && (record[key] as string).length > 0) {
      return record[key] as string;
    }
  }
  return "";
}

function numberField(
  record: Record<string, unknown> | null,
  ...keys: string[]
): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function codeResultOutput(value: unknown): {
  output: string;
  exitCode: number | null;
} {
  const decoded = decodeResult(value);
  if (typeof decoded === "string") {
    return { output: decoded.trim(), exitCode: null };
  }
  const record = recordOf(decoded);
  if (!record) return { output: "", exitCode: null };
  const stdout = stringField(
    record,
    "output",
    "stdout",
    "content",
    "text",
    "message",
    "error",
  ).trim();
  const stderr = stringField(record, "stderr").trim();
  return {
    output:
      stdout && stderr && stdout !== stderr
        ? `${stdout}\n\n${stderr}`
        : stdout || stderr,
    exitCode: numberField(record, "exit_code", "exitCode", "code"),
  };
}

export function workspaceCodeExecution(
  event: HermesToolProgress,
): CodeExecutionResource | null {
  if (event.tool !== "execute_code") return null;
  const code = stringField(event.args ?? {}, "code");
  if (!code.trim()) return null;
  const result = codeResultOutput(event.result);
  const suppliedLanguage = firstString(
    event.args ?? {},
    "language",
    "lang",
    "runtime",
  )
    .trim()
    .toLowerCase();
  const languageAliases: Record<string, string> = {
    py: "python",
    py3: "python",
    python3: "python",
    node: "javascript",
    nodejs: "javascript",
  };
  return {
    kind: "code",
    toolCallId: event.toolCallId,
    // Hermes execute_code runs Python and does not include a language field.
    // Keep explicit adapter languages, but load the Python parser by default.
    language:
      (languageAliases[suppliedLanguage] ?? suppliedLanguage) || "python",
    code,
    output: result.output,
    workdir: firstString(event.args ?? {}, "workdir", "cwd"),
    exitCode: result.exitCode,
    failed:
      Boolean(event.error) ||
      (result.exitCode !== null && result.exitCode !== 0),
    status: event.status,
    durationMs: event.durationMs,
  };
}

export function canInspectWorkspaceTool(event: HermesToolProgress): boolean {
  return (
    event.tool === "read_file" ||
    event.tool === "write_file" ||
    event.tool === "patch" ||
    event.tool === "execute_code"
  );
}

function isMutationTool(event: HermesToolProgress): boolean {
  return event.tool === "write_file" || event.tool === "patch";
}

function resourceTitle(resource: WorkspacePaneResource): string {
  if (resource.kind === "file") return workspaceTabLabel(resource.path);
  if (resource.kind === "code") return languageLabel(resource.language);
  return "Review";
}

function resourceTabLabels(resource: WorkspacePaneResource): {
  primary: string;
  context: string;
} {
  const label = resourceTitle(resource);
  if (resource.kind !== "file") return { primary: label, context: "" };
  const separator = label.lastIndexOf(" · ");
  if (separator < 0) return { primary: label, context: "" };
  return {
    primary: label.slice(0, separator),
    context: label.slice(separator + 3),
  };
}

function WorkspaceTabIcon({
  resource,
  className,
}: {
  resource: WorkspacePaneResource;
  className?: string;
}) {
  if (resource.kind === "diff") {
    return (
      <FileDiff
        className={cn("text-muted-foreground/80", className)}
        aria-hidden
      />
    );
  }
  if (resource.kind === "code") {
    return (
      <Code2
        className={cn("text-muted-foreground/80", className)}
        aria-hidden
      />
    );
  }

  const path = resource.path.toLowerCase();
  let Icon: LucideIcon = FileCode2;
  let tone = "text-sky-600/75 dark:text-sky-300/75";
  if (/\.[jt]sx$/.test(path)) {
    Icon = Atom;
    tone = "text-cyan-600/75 dark:text-cyan-300/75";
  } else if (/\.jsonc?$/.test(path)) {
    Icon = Braces;
    tone = "text-amber-600/75 dark:text-amber-300/75";
  } else if (/\.(html?|xml|svg)$/.test(path)) {
    Icon = CodeXml;
    tone = "text-orange-600/75 dark:text-orange-300/75";
  } else if (/\.(css|scss|less)$/.test(path)) {
    Icon = Hash;
    tone = "text-violet-600/70 dark:text-violet-300/75";
  } else if (/\.(mdx?|txt)$/.test(path)) {
    Icon = FileText;
    tone = "text-muted-foreground/80";
  }
  return <Icon className={cn(tone, className)} aria-hidden />;
}

function WorkspaceTabButton({
  tab,
  selected,
  labels,
  onSelect,
  onClose,
}: {
  tab: WorkspacePaneTab;
  selected: boolean;
  labels: { primary: string; context: string };
  onSelect(): void;
  onClose(): void;
}) {
  const { t } = useT();
  const tabRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selected) return;
    tabRef.current?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
    });
  }, [selected]);

  return (
    <div
      ref={tabRef}
      className={cn(
        "group/tab flex h-8 max-w-[210px] shrink-0 items-center rounded-[10px] px-1.5 transition-colors duration-150",
        selected
          ? "bg-muted/65 text-foreground"
          : "text-muted-foreground/82 hover:bg-muted/30 hover:text-foreground/85",
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={selected}
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 px-1"
        title={
          tab.resource.kind === "file" ? tab.resource.path : labels.primary
        }
      >
        <WorkspaceTabIcon
          resource={tab.resource}
          className="h-4 w-4 shrink-0"
        />
        <span className="min-w-0 truncate text-[11px] font-medium tracking-[-0.01em]">
          {labels.primary}
        </span>
        {labels.context && (
          <span
            className={cn(
              "shrink truncate text-[9.5px] font-normal text-muted-foreground/58",
              selected ? "max-w-[42px]" : "max-w-[60px]",
            )}
          >
            · {labels.context}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onClose}
        title={t("common.close")}
        aria-label={t("common.close")}
        className={cn(
          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-[color,background-color,opacity] hover:bg-foreground/[0.06] hover:text-foreground focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
          selected ? "opacity-65" : "opacity-0 group-hover/tab:opacity-65",
        )}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function resourceKey(resource: WorkspacePaneResource): string {
  if (resource.kind === "file") return `file:${resource.path}`;
  if (resource.kind === "code") return `code:${resource.toolCallId}`;
  return `diff:${resource.reviewId}`;
}

function languageLabel(language: string): string {
  const normalized = language.trim().toLowerCase();
  const labels: Record<string, string> = {
    js: "JavaScript",
    javascript: "JavaScript",
    jsx: "JSX",
    html: "HTML",
    htm: "HTML",
    json: "JSON",
    jsonc: "JSON",
    css: "CSS",
    scss: "SCSS",
    less: "Less",
    markdown: "Markdown",
    md: "Markdown",
    mdx: "MDX",
    ts: "TypeScript",
    typescript: "TypeScript",
    tsx: "TSX",
    py: "Python",
    python: "Python",
    bash: "Shell",
    sh: "Shell",
    shell: "Shell",
    zsh: "Shell",
    rust: "Rust",
    rs: "Rust",
    go: "Go",
    ruby: "Ruby",
    rb: "Ruby",
    php: "PHP",
  };
  return labels[normalized] ?? (language.trim() || "Code");
}

function clampPaneWidth(value: number): number {
  return Math.min(MAX_PANE_WIDTH, Math.max(MIN_PANE_WIDTH, Math.round(value)));
}

function emptySessionState(): SessionPaneState {
  return { tabs: [], activeTabId: null };
}

export function WorkspacePaneProvider({
  capability,
  sessionId,
  children,
}: {
  capability?: WorkspaceInspectorCapability;
  sessionId: string;
  children: ReactNode;
}) {
  const [open, setOpenState] = useState(false);
  const [width, setWidthState] = useState(DEFAULT_PANE_WIDTH);
  const [sessionStates, setSessionStates] = useState<
    Record<string, SessionPaneState>
  >({});
  const autoOpenedToolIds = useRef(new Set<string>());
  const activeTurnReviewIds = useRef(new Map<string, string>());
  const turnSequence = useRef(0);
  const enabled = Boolean(capability && sessionId);
  const activeState = sessionStates[sessionId] ?? emptySessionState();
  const activeTab =
    activeState.tabs.find((tab) => tab.id === activeState.activeTabId) ?? null;

  useEffect(() => {
    if (!capability) return;
    let cancelled = false;
    const storage = getPlatform().storage;
    void storage.get([PANE_OPEN_KEY, PANE_WIDTH_KEY]).then((result) => {
      if (cancelled) return;
      if (typeof result[PANE_OPEN_KEY] === "boolean") {
        setOpenState(result[PANE_OPEN_KEY] as boolean);
      }
      if (
        typeof result[PANE_WIDTH_KEY] === "number" &&
        Number.isFinite(result[PANE_WIDTH_KEY])
      ) {
        setWidthState(clampPaneWidth(result[PANE_WIDTH_KEY] as number));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [capability]);

  const updateActiveSession = useCallback(
    (updater: (state: SessionPaneState) => SessionPaneState) => {
      if (!sessionId) return;
      setSessionStates((current) => ({
        ...current,
        [sessionId]: updater(current[sessionId] ?? emptySessionState()),
      }));
    },
    [sessionId],
  );

  const persistOpen = useCallback((next: boolean) => {
    setOpenState(next);
    void getPlatform().storage.set({ [PANE_OPEN_KEY]: next });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.code !== "Backslash" ||
        !event.shiftKey ||
        (!event.metaKey && !event.ctrlKey)
      ) {
        return;
      }
      event.preventDefault();
      persistOpen(!open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, open, persistOpen]);

  const setWidth = useCallback((next: number) => {
    const clamped = clampPaneWidth(next);
    setWidthState(clamped);
  }, []);

  const openResource = useCallback(
    (resource: WorkspacePaneResource, source: "automatic" | "user") => {
      if (!capability || !sessionId) return;
      updateActiveSession((state) => {
        const nextResourceKey = resourceKey(resource);
        const existing = state.tabs.find(
          (tab) => resourceKey(tab.resource) === nextResourceKey,
        );
        if (existing) {
          const existingEntries =
            existing.resource.kind === "diff" ? existing.resource.entries : [];
          const nextResource =
            existing.resource.kind === "diff" && resource.kind === "diff"
              ? {
                  ...resource,
                  entries: [
                    ...existingEntries,
                    ...resource.entries.filter(
                      (entry) =>
                        !existingEntries.some(
                          (current) => current.toolCallId === entry.toolCallId,
                        ),
                    ),
                  ],
                }
              : resource;
          return {
            tabs: state.tabs.map((tab) =>
              tab.id === existing.id
                ? {
                    ...tab,
                    resource: nextResource,
                    pinned: tab.pinned || source === "user",
                  }
                : tab,
            ),
            activeTabId: existing.id,
          };
        }

        if (source === "automatic") {
          const previewIndex = state.tabs.findIndex((tab) => !tab.pinned);
          const previewTab: WorkspacePaneTab = {
            id: `preview:${sessionId}`,
            resource,
            pinned: false,
          };
          if (previewIndex >= 0) {
            const tabs = [...state.tabs];
            tabs[previewIndex] = previewTab;
            return { tabs, activeTabId: previewTab.id };
          }
          return {
            tabs: [...state.tabs, previewTab],
            activeTabId: previewTab.id,
          };
        }

        const tab: WorkspacePaneTab = {
          id: nextResourceKey,
          resource,
          pinned: true,
        };
        const tabs = [...state.tabs, tab].slice(-10);
        return { tabs, activeTabId: tab.id };
      });
      persistOpen(true);
    },
    [capability, persistOpen, sessionId, updateActiveSession],
  );

  const openFile = useCallback(
    (path: string, line?: number) => {
      openResource({ kind: "file", path, line }, "user");
    },
    [openResource],
  );

  const beginTurn = useCallback(() => {
    if (!sessionId) return;
    turnSequence.current += 1;
    activeTurnReviewIds.current.set(
      sessionId,
      `turn:${sessionId}:${turnSequence.current}`,
    );
  }, [sessionId]);

  const canOpenToolEvent = useCallback(
    (event: HermesToolProgress) =>
      Boolean(
        capability &&
          canInspectWorkspaceTool(event) &&
          (event.tool === "execute_code"
            ? workspaceCodeExecution(event)
            : workspaceFileTargets(event).length > 0),
      ),
    [capability],
  );

  const openToolEvent = useCallback(
    (event: HermesToolProgress) => {
      const codeExecution = workspaceCodeExecution(event);
      if (codeExecution) {
        openResource(codeExecution, "user");
        return;
      }
      const paths = workspaceFileTargets(event);
      if (paths.length === 0) return;
      const line =
        typeof event.args?.offset === "number" ? event.args.offset : undefined;
      if (isMutationTool(event) && event.inlineDiff?.trim()) {
        openResource(
          {
            kind: "diff",
            reviewId: `tool:${event.toolCallId}`,
            scope: "tool",
            entries: [
              {
                toolCallId: event.toolCallId,
                diff: event.inlineDiff,
                paths,
              },
            ],
          },
          "user",
        );
        return;
      }
      openResource(
        {
          kind: "file",
          path: paths[0]!,
          line,
          sourceToolCallId: event.toolCallId,
        },
        "user",
      );
    },
    [openResource],
  );

  const observeToolEvent = useCallback(
    (event: HermesToolProgress) => {
      const codeExecution = workspaceCodeExecution(event);
      if (capability && codeExecution) {
        updateActiveSession((state) => ({
          ...state,
          tabs: state.tabs.map((tab) =>
            resourceKey(tab.resource) === resourceKey(codeExecution)
              ? { ...tab, resource: codeExecution }
              : tab,
          ),
        }));
        return;
      }
      if (
        !capability ||
        event.status !== "completed" ||
        event.error ||
        !isMutationTool(event) ||
        autoOpenedToolIds.current.has(event.toolCallId)
      ) {
        return;
      }
      const paths = workspaceFileTargets(event);
      if (paths.length === 0) return;
      autoOpenedToolIds.current.add(event.toolCallId);
      if (event.inlineDiff?.trim()) {
        const reviewId =
          activeTurnReviewIds.current.get(sessionId) ??
          `turn:${sessionId}:${event.toolCallId}`;
        openResource(
          {
            kind: "diff",
            reviewId,
            scope: "turn",
            entries: [
              {
                toolCallId: event.toolCallId,
                diff: event.inlineDiff,
                paths,
              },
            ],
          },
          "automatic",
        );
      } else {
        openResource(
          {
            kind: "file",
            path: paths[0]!,
            sourceToolCallId: event.toolCallId,
          },
          "automatic",
        );
      }
    },
    [capability, openResource, sessionId, updateActiveSession],
  );

  const value = useMemo<WorkspacePaneContextValue>(
    () => ({
      enabled,
      open: enabled && open,
      width,
      tabs: activeState.tabs,
      activeTab,
      sessionId,
      files: capability?.files,
      setOpen: persistOpen,
      toggle: () => persistOpen(!open),
      setWidth,
      selectTab: (id) =>
        updateActiveSession((state) => ({
          ...state,
          activeTabId: id,
          tabs: state.tabs.map((tab) =>
            tab.id === id ? { ...tab, pinned: true } : tab,
          ),
        })),
      closeTab: (id) =>
        updateActiveSession((state) => {
          const index = state.tabs.findIndex((tab) => tab.id === id);
          const tabs = state.tabs.filter((tab) => tab.id !== id);
          if (state.activeTabId !== id) return { ...state, tabs };
          const fallback = tabs[Math.max(0, index - 1)] ?? tabs[0] ?? null;
          return { tabs, activeTabId: fallback?.id ?? null };
        }),
      openFile,
      beginTurn,
      canOpenToolEvent,
      openToolEvent,
      observeToolEvent,
    }),
    [
      activeState.tabs,
      activeTab,
      beginTurn,
      canOpenToolEvent,
      capability,
      enabled,
      observeToolEvent,
      open,
      openFile,
      openToolEvent,
      persistOpen,
      sessionId,
      setWidth,
      updateActiveSession,
      width,
    ],
  );

  return (
    <WorkspacePaneContext.Provider value={value}>
      {children}
    </WorkspacePaneContext.Provider>
  );
}

export function useWorkspacePane(): WorkspacePaneContextValue {
  return useContext(WorkspacePaneContext);
}

export function WorkspacePaneToggle({ className }: { className?: string }) {
  const pane = useWorkspacePane();
  const { t } = useT();
  if (!pane.enabled) return null;
  return (
    <button
      type="button"
      onClick={pane.toggle}
      title={pane.open ? t("workspacePane.collapse") : t("workspacePane.open")}
      aria-label={
        pane.open ? t("workspacePane.collapse") : t("workspacePane.open")
      }
      aria-pressed={pane.open}
      aria-keyshortcuts="Meta+Shift+Backslash Control+Shift+Backslash"
      className={cn(
        "app-no-drag relative inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors",
        "hover:bg-foreground/5 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        pane.open && "bg-foreground/5 text-foreground",
        className,
      )}
    >
      <PanelRight className="h-3.5 w-3.5" />
      {!pane.open && pane.tabs.length > 0 && (
        <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" />
      )}
    </button>
  );
}

interface PreviewMenuItem {
  label: string;
  icon: LucideIcon;
  onSelect(): void;
}

function PreviewAction({
  label,
  icon: Icon,
  onSelect,
  onClick,
}: PreviewMenuItem & { onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick ?? onSelect}
      title={label}
      aria-label={label}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

function PreviewMoreMenu({ items }: { items: PreviewMenuItem[] }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);

  if (!items.length) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={t("workspacePane.moreActions")}
          aria-label={t("workspacePane.moreActions")}
          aria-haspopup="menu"
          aria-expanded={open}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" role="menu" side="bottom" size="compact">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[11px] text-foreground/80 transition-colors hover:bg-muted/70 hover:text-foreground"
            >
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              {item.label}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

function PreviewHeader({
  icon: Icon,
  title,
  meta,
  status,
  actions,
  primaryAction,
  moreActions = [],
}: {
  icon: LucideIcon;
  title: ReactNode;
  meta?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  primaryAction?: PreviewMenuItem;
  moreActions?: PreviewMenuItem[];
}) {
  return (
    <div className="relative z-30 flex h-10 shrink-0 items-center gap-2 border-b border-border/30 bg-background/95 px-3 backdrop-blur">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
      <div
        className={cn(
          "text-[11px] font-medium text-foreground/82",
          meta ? "shrink-0" : "min-w-0 flex-1 truncate",
        )}
      >
        {title}
      </div>
      {meta && (
        <div className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
          {meta}
        </div>
      )}
      {status && <div className="flex h-7 shrink-0 items-center">{status}</div>}
      {actions}
      {primaryAction && <PreviewAction {...primaryAction} />}
      <PreviewMoreMenu items={moreActions} />
    </div>
  );
}

function codeLanguageExtension(
  sourcePath: string,
  language?: string,
): Extension | null {
  const normalizedLanguage = language?.trim().toLowerCase() ?? "";
  const normalizedPath = sourcePath.toLowerCase();
  if (
    ["typescript", "ts", "tsx", "javascript", "js", "jsx"].includes(
      normalizedLanguage,
    ) ||
    /\.[cm]?[jt]sx?$/.test(normalizedPath)
  ) {
    const jsx =
      ["jsx", "tsx"].includes(normalizedLanguage) ||
      /\.[jt]sx$/.test(normalizedPath);
    const typescript =
      ["typescript", "ts", "tsx"].includes(normalizedLanguage) ||
      /\.[cm]?tsx?$/.test(normalizedPath);
    return javascript({ jsx, typescript });
  }
  if (
    ["html", "htm", "xml", "svg"].includes(normalizedLanguage) ||
    /\.(html?|xml|svg)$/.test(normalizedPath)
  ) {
    return html();
  }
  if (
    ["json", "jsonc"].includes(normalizedLanguage) ||
    /\.jsonc?$/.test(normalizedPath)
  ) {
    return json();
  }
  if (
    ["css", "scss", "less"].includes(normalizedLanguage) ||
    /\.(css|scss|less)$/.test(normalizedPath)
  ) {
    return css();
  }
  if (
    ["markdown", "md", "mdx"].includes(normalizedLanguage) ||
    /\.mdx?$/.test(normalizedPath)
  ) {
    return markdown();
  }
  if (
    ["python", "python3", "py", "py3"].includes(normalizedLanguage) ||
    /\.pyw?$/.test(normalizedPath)
  ) {
    return python();
  }
  return null;
}

function CodeEditor({
  content,
  sourcePath,
  language,
  line,
  highlightLine = true,
}: {
  content: string;
  sourcePath: string;
  language?: string;
  line?: number;
  highlightLine?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const extensions: Extension[] = [
      lineNumbers(),
      keymap.of(defaultKeymap),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      syntaxHighlighting(WORKSPACE_CODE_HIGHLIGHT),
      EditorView.theme({
        "&": {
          height: "100%",
          backgroundColor: "hsl(var(--background))",
          color: "hsl(var(--foreground))",
          fontSize: "12px",
        },
        ".cm-scroller": {
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          lineHeight: "1.58",
        },
        ".cm-content": { padding: "10px 0 24px" },
        ".cm-gutters": {
          backgroundColor: "hsl(var(--muted) / 0.22)",
          color: "hsl(var(--muted-foreground) / 0.55)",
          border: "none",
          paddingLeft: "4px",
        },
        ".cm-activeLine, .cm-activeLineGutter": {
          backgroundColor: "hsl(var(--muted) / 0.38)",
        },
        ".cm-selectionBackground": {
          backgroundColor: "hsl(var(--primary) / 0.12) !important",
        },
        ".cm-focused": { outline: "none" },
        ".cm-syntax-comment": {
          color: "hsl(var(--muted-foreground) / 0.72)",
          fontStyle: "italic",
        },
        ".cm-syntax-keyword": {
          color: "light-dark(#6d28d9, #c4b5fd)",
        },
        ".cm-syntax-string": {
          color: "light-dark(#15803d, #86efac)",
        },
        ".cm-syntax-number": {
          color: "light-dark(#0369a1, #7dd3fc)",
        },
        ".cm-syntax-type": {
          color: "light-dark(#b45309, #fcd34d)",
        },
        ".cm-syntax-function": {
          color: "light-dark(#1d4ed8, #93c5fd)",
        },
        ".cm-syntax-property": {
          color: "light-dark(#9f1239, #fda4af)",
        },
        ".cm-syntax-operator": {
          color: "hsl(var(--foreground) / 0.66)",
        },
      }),
    ];
    if (highlightLine) {
      extensions.push(highlightActiveLine(), highlightActiveLineGutter());
    }
    const languageExtension = codeLanguageExtension(sourcePath, language);
    if (languageExtension) extensions.push(languageExtension);
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({ doc: content, extensions }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [highlightLine, language, sourcePath]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (view.state.doc.toString() !== content) {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: content,
        },
      });
    }
    if (line && line > 0) {
      const targetLine = Math.min(line, view.state.doc.lines);
      const position = view.state.doc.line(targetLine).from;
      view.dispatch({
        selection: { anchor: position },
        effects: EditorView.scrollIntoView(position, { y: "center" }),
      });
    }
  }, [content, line]);

  return (
    <div
      ref={hostRef}
      data-selection="text"
      className="h-full min-h-0 overflow-hidden"
    />
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function WorkspaceFileView({
  resource,
  sessionId,
  files,
}: {
  resource: FileResource;
  sessionId: string;
  files: WorkspaceFilesAdapter;
}) {
  const { t } = useT();
  const [document, setDocument] = useState<WorkspaceFileDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await files.read(sessionId, resource.path);
      if (request !== requestRef.current) return;
      setDocument(next);
    } catch (cause) {
      if (request !== requestRef.current) return;
      setDocument(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [files, resource.path, sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const path = document?.path ?? resource.path;
    return files.watch(sessionId, [path], (change) => {
      if (change.event === "unlink") {
        setDocument(null);
        setError(t("workspacePane.fileDeleted"));
        setLoading(false);
        return;
      }
      void load();
    });
  }, [document?.path, files, load, resource.path, sessionId, t]);

  const targetPath = document?.path ?? resource.path;
  const displayPath = document?.relativePath ?? resource.path;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PreviewHeader
        icon={FileCode2}
        title={
          <span className="font-mono" title={targetPath}>
            {displayPath}
          </span>
        }
        status={
          document ? (
            <span className="font-mono text-[9.5px] leading-none tabular-nums text-muted-foreground/70">
              {formatBytes(document.size)}
            </span>
          ) : null
        }
        primaryAction={{
          icon: Copy,
          label: t("workspacePane.copyPath"),
          onSelect: () => void navigator.clipboard.writeText(targetPath),
        }}
        moreActions={[
          {
            icon: FolderOpen,
            label: t("workspacePane.revealFile"),
            onSelect: () =>
              void files.reveal(sessionId, targetPath).catch(() => {}),
          },
          {
            icon: ExternalLink,
            label: t("workspacePane.openExternal"),
            onSelect: () =>
              void files.openExternal(sessionId, targetPath).catch(() => {}),
          },
        ]}
      />
      {loading && !document ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-xs text-muted-foreground">
          {t("workspacePane.loadingFile")}
        </div>
      ) : error || !document ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <FileCode2 className="h-5 w-5 text-muted-foreground/50" />
          <div className="max-w-sm text-xs text-muted-foreground">
            {error || t("workspacePane.fileUnavailable")}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/70 px-2.5 text-[11px] text-foreground transition-colors hover:bg-muted/50"
          >
            <RotateCw className="h-3 w-3" />
            {t("common.retry")}
          </button>
        </div>
      ) : document.binary ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
          <FileCode2 className="h-5 w-5 text-muted-foreground/50" />
          <div className="text-xs font-medium">{document.name}</div>
          <div className="text-[11px] text-muted-foreground">
            {t("workspacePane.binaryFile")} · {formatBytes(document.size)}
          </div>
        </div>
      ) : (
        <>
          {(document.truncated || loading) && (
            <div className="flex h-7 shrink-0 items-center border-b border-border/25 bg-muted/20 px-3 text-[10px] text-muted-foreground">
              {loading
                ? t("workspacePane.refreshing")
                : t("workspacePane.truncated", {
                    size: formatBytes(document.size),
                  })}
            </div>
          )}
          <div className="min-h-0 flex-1">
            <CodeEditor
              content={document.content}
              sourcePath={document.path}
              line={resource.line}
            />
          </div>
        </>
      )}
    </div>
  );
}

function CodeExecutionView({ resource }: { resource: CodeExecutionResource }) {
  const { t } = useT();
  const language = languageLabel(resource.language);
  const completed = resource.status === "completed";
  const duration =
    typeof resource.durationMs === "number"
      ? formatToolDuration(resource.durationMs)
      : "";
  const status = resource.failed ? (
    <span className="inline-flex items-center gap-1 font-mono text-[10px] text-destructive/85">
      <CircleAlert className="h-3.5 w-3.5" />
      {resource.exitCode !== null
        ? `exit ${resource.exitCode}`
        : t("workspacePane.failed")}
    </span>
  ) : completed ? (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600/75 dark:text-emerald-400/75" />
      {duration}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <span className="hermes-thinking-dot" />
      {t("workspacePane.running")}
    </span>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PreviewHeader
        icon={Code2}
        title={t("workspacePane.codeRun")}
        meta={
          <span className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[9px] text-foreground/65">
              {language}
            </span>
            {resource.workdir && (
              <span
                className="min-w-0 truncate font-mono text-[9.5px]"
                title={resource.workdir}
              >
                {compactWorkspacePath(resource.workdir, 5)}
              </span>
            )}
          </span>
        }
        status={status}
        primaryAction={{
          icon: Copy,
          label: t("workspacePane.copyCode"),
          onSelect: () => void navigator.clipboard.writeText(resource.code),
        }}
        moreActions={[
          ...(resource.output
            ? [
                {
                  icon: Copy,
                  label: t("workspacePane.copyOutput"),
                  onSelect: () =>
                    void navigator.clipboard.writeText(resource.output),
                },
              ]
            : []),
          ...(resource.workdir
            ? [
                {
                  icon: Copy,
                  label: t("workspacePane.copyWorkingDirectory"),
                  onSelect: () =>
                    void navigator.clipboard.writeText(resource.workdir),
                },
              ]
            : []),
        ]}
      />
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <section
          aria-label={t("workspacePane.code")}
          className="min-h-0 flex-1 overflow-hidden bg-muted/[0.08]"
        >
          <CodeEditor
            content={resource.code}
            sourcePath=""
            language={resource.language}
            highlightLine={false}
          />
        </section>
        {(resource.output || completed) && (
          <section className="flex min-h-24 max-h-[42%] shrink-0 flex-col border-t border-border/35">
            <div className="flex h-7 shrink-0 items-center justify-between bg-muted/20 px-3 text-[9.5px] font-medium text-muted-foreground">
              <span>{t("workspacePane.output")}</span>
              {resource.exitCode !== null && (
                <span
                  className={cn(
                    "font-mono",
                    resource.exitCode !== 0 && "text-destructive/80",
                  )}
                >
                  exit {resource.exitCode}
                </span>
              )}
            </div>
            <pre
              data-selection="text"
              className={cn(
                "min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-[10.5px] leading-[1.65]",
                resource.failed ? "text-destructive/85" : "text-foreground/72",
              )}
            >
              {resource.output || t("workspacePane.noOutput")}
            </pre>
          </section>
        )}
      </div>
    </div>
  );
}

function ReviewCodeRow({ line }: { line: WorkspaceReviewLine }) {
  if (line.kind === "meta") {
    return (
      <div className="grid min-w-max grid-cols-[40px_40px_minmax(320px,1fr)] bg-muted/18 text-muted-foreground/55">
        <span />
        <span />
        <span className="px-3 py-0.5">{line.content}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid min-w-max grid-cols-[40px_40px_minmax(320px,1fr)]",
        line.kind === "addition" &&
          "bg-emerald-500/[0.11] text-emerald-950 dark:text-emerald-50",
        line.kind === "deletion" &&
          "bg-red-500/[0.1] text-red-950 dark:text-red-50",
      )}
    >
      <span
        className={cn(
          "select-none border-r border-border/20 pr-2 text-right text-muted-foreground/42",
          line.kind === "deletion" && "border-l-2 border-l-red-500",
        )}
      >
        {line.oldLine ?? ""}
      </span>
      <span
        className={cn(
          "select-none border-r border-border/20 pr-2 text-right text-muted-foreground/42",
          line.kind === "addition" && "border-l-2 border-l-emerald-500",
        )}
      >
        {line.newLine ?? ""}
      </span>
      <span className="whitespace-pre px-3">{line.content || " "}</span>
    </div>
  );
}

function ReviewGapRow({
  gap,
  filePath,
  sessionId,
  files,
}: {
  gap: WorkspaceReviewGap;
  filePath: string;
  sessionId: string;
  files?: WorkspaceFilesAdapter;
}) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState<string[] | null>(null);
  const [error, setError] = useState(false);

  const toggle = useCallback(async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (!content && files) {
      setLoading(true);
      setError(false);
      try {
        const document = await files.read(sessionId, filePath);
        if (document.binary) throw new Error("binary");
        setContent(document.content.split(/\r?\n/));
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    }
    setExpanded(true);
  }, [content, expanded, filePath, files, sessionId]);

  const visibleCount = Math.min(gap.count, 200);
  const expandedLines =
    expanded && content
      ? content.slice(gap.newStart - 1, gap.newStart - 1 + visibleCount)
      : [];

  return (
    <>
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={!files || loading}
        className="grid min-w-full grid-cols-[80px_minmax(320px,1fr)] bg-muted/45 text-left text-[10px] text-muted-foreground transition-colors hover:bg-muted/65 hover:text-foreground disabled:cursor-default"
        title={error ? t("workspacePane.contextUnavailable") : undefined}
      >
        <span className="flex items-center justify-center">
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </span>
        <span className="px-3 py-1">
          {loading
            ? t("common.loading")
            : t("workspacePane.unmodifiedLines", { count: gap.count })}
        </span>
      </button>
      {expandedLines.map((line, index) => (
        <ReviewCodeRow
          key={`${gap.oldStart}:${index}`}
          line={{
            kind: "context",
            content: line,
            oldLine: gap.oldStart + index,
            newLine: gap.newStart + index,
          }}
        />
      ))}
      {expanded && gap.count > visibleCount && (
        <div className="grid min-w-max grid-cols-[80px_minmax(320px,1fr)] bg-muted/30 text-[10px] text-muted-foreground">
          <span />
          <span className="px-3 py-1">
            {t("workspacePane.moreUnmodifiedLines", {
              count: gap.count - visibleCount,
            })}
          </span>
        </div>
      )}
    </>
  );
}

function ReviewFileSection({
  file,
  collapsed,
  onToggle,
  onOpenFile,
  sessionId,
  files,
}: {
  file: WorkspaceReviewFile;
  collapsed: boolean;
  onToggle(): void;
  onOpenFile(path: string): void;
  sessionId: string;
  files?: WorkspaceFilesAdapter;
}) {
  const { t } = useT();

  return (
    <section>
      <div className="group sticky top-0 z-10 flex h-9 items-center gap-2 border-b border-border/25 bg-muted/[0.12] px-2.5 backdrop-blur">
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex h-6 w-5 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
          title={
            collapsed
              ? t("workspacePane.expandFile")
              : t("workspacePane.collapseFile")
          }
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
        <FileCode2 className="h-3.5 w-3.5 shrink-0 text-sky-600/75 dark:text-sky-300/75" />
        <button
          type="button"
          onClick={() => onOpenFile(file.path)}
          className="min-w-0 flex-1 truncate text-left font-mono text-[10px] text-foreground/72 hover:text-foreground"
          title={file.path}
        >
          {compactWorkspacePath(file.path, 6)}
        </button>
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px]">
          {file.additions > 0 && (
            <span className="text-emerald-600 dark:text-emerald-400">
              +{file.additions}
            </span>
          )}
          {file.deletions > 0 && (
            <span className="text-red-600 dark:text-red-400">
              -{file.deletions}
            </span>
          )}
        </span>
        <PreviewMoreMenu
          items={[
            {
              icon: Copy,
              label: t("workspacePane.copyPath"),
              onSelect: () => void navigator.clipboard.writeText(file.path),
            },
            ...(files
              ? [
                  {
                    icon: FolderOpen,
                    label: t("workspacePane.revealFile"),
                    onSelect: () =>
                      void files.reveal(sessionId, file.path).catch(() => {}),
                  },
                  {
                    icon: ExternalLink,
                    label: t("workspacePane.openExternal"),
                    onSelect: () =>
                      void files
                        .openExternal(sessionId, file.path)
                        .catch(() => {}),
                  },
                ]
              : []),
          ]}
        />
      </div>
      {!collapsed && (
        <div className="overflow-x-auto py-1 font-mono text-[10.5px] leading-[1.65]">
          {file.rows.map((row, index) =>
            row.kind === "gap" ? (
              <ReviewGapRow
                key={`gap:${row.oldStart}:${row.newStart}:${index}`}
                gap={row}
                filePath={file.path}
                sessionId={sessionId}
                files={files}
              />
            ) : (
              <ReviewCodeRow
                key={`${row.kind}:${row.oldLine}:${row.newLine}:${index}`}
                line={row}
              />
            ),
          )}
        </div>
      )}
    </section>
  );
}

function DiffView({
  resource,
  onOpenFile,
  sessionId,
  files,
}: {
  resource: DiffResource;
  onOpenFile(path: string): void;
  sessionId: string;
  files?: WorkspaceFilesAdapter;
}) {
  const { t } = useT();
  const review = useMemo(
    () => parseWorkspaceReview(resource.entries),
    [resource.entries],
  );
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const allCollapsed =
    review.files.length > 0 &&
    review.files.every((file) => collapsedPaths.has(file.path));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PreviewHeader
        icon={FileDiff}
        title={
          resource.scope === "turn"
            ? t("workspacePane.currentTurn")
            : t("workspacePane.toolChange")
        }
        meta={t("workspacePane.filesChanged", {
          count: review.files.length,
        })}
        status={
          <span className="flex items-center gap-1.5 font-mono text-[10px]">
            <span className="text-emerald-600 dark:text-emerald-400">
              +{review.additions}
            </span>
            <span className="text-red-600 dark:text-red-400">
              -{review.deletions}
            </span>
          </span>
        }
        actions={
          review.files.length > 1 ? (
            <button
              type="button"
              onClick={() =>
                setCollapsedPaths(
                  allCollapsed
                    ? new Set()
                    : new Set(review.files.map((file) => file.path)),
                )
              }
              className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[10px] text-muted-foreground hover:bg-muted/55 hover:text-foreground"
            >
              {allCollapsed ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              {allCollapsed
                ? t("workspacePane.expandAll")
                : t("workspacePane.collapseAll")}
            </button>
          ) : null
        }
        moreActions={[
          {
            icon: Copy,
            label: t("workspacePane.copyDiff"),
            onSelect: () =>
              void navigator.clipboard.writeText(
                resource.entries.map((entry) => entry.diff).join("\n"),
              ),
          },
        ]}
      />
      <div
        data-selection="text"
        className="min-h-0 flex-1 overflow-auto bg-background"
      >
        {review.files.length ? (
          review.files.map((file) => (
            <ReviewFileSection
              key={file.path}
              file={file}
              collapsed={collapsedPaths.has(file.path)}
              onToggle={() =>
                setCollapsedPaths((current) => {
                  const next = new Set(current);
                  if (next.has(file.path)) next.delete(file.path);
                  else next.add(file.path);
                  return next;
                })
              }
              onOpenFile={onOpenFile}
              sessionId={sessionId}
              files={files}
            />
          ))
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {t("workspacePane.noDiff")}
          </div>
        )}
      </div>
    </div>
  );
}

function WorkspaceEmptyState() {
  const { t } = useT();
  const kinds = [
    {
      icon: FileCode2,
      label: t("workspacePane.emptyFiles"),
      className: "bg-muted/45 text-muted-foreground/65",
    },
    {
      icon: FileDiff,
      label: t("workspacePane.emptyChanges"),
      className: "bg-muted/35 text-muted-foreground/55",
    },
    {
      icon: Code2,
      label: t("workspacePane.emptyRuns"),
      className: "bg-muted/25 text-muted-foreground/50",
    },
  ];

  return (
    <div className="flex h-full items-center justify-center px-10 pb-[9vh]">
      <div className="w-full max-w-[292px] text-left">
        <div className="mb-4 flex items-start gap-1.5" aria-hidden>
          {kinds.map(({ icon: Icon, label, className }) => (
            <div
              key={label}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md",
                className,
              )}
            >
              <Icon className="h-3 w-3" strokeWidth={1.7} />
            </div>
          ))}
        </div>
        <div className="text-[12px] font-normal tracking-[-0.005em] text-muted-foreground/78">
          {t("workspacePane.emptyTitle")}
        </div>
        <div className="mt-1.5 max-w-[280px] text-[10.5px] leading-[1.65] text-muted-foreground/58">
          {t("workspacePane.emptyBody")}
        </div>
      </div>
    </div>
  );
}

function SessionTaskFlow({ tasks }: { tasks: HermesKanbanTask[] }) {
  const { t } = useT();
  const ordered = useMemo(
    () => [...tasks].sort((a, b) => a.created_at - b.created_at),
    [tasks],
  );
  return (
    <ScrollArea className="h-full">
      <div className="px-4 pb-5 pt-2">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold">
            {t("workspacePane.collaboration")}
          </h3>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {t("workspacePane.taskCount", { count: tasks.length })}
          </span>
        </div>
        <div className="relative space-y-1 before:absolute before:bottom-3 before:left-[7px] before:top-3 before:w-px before:bg-border/70">
          {ordered.map((task) => (
            <article
              key={task.id}
              className="relative ml-0 grid grid-cols-[16px_minmax(0,1fr)] gap-2.5 rounded-xl px-1 py-2"
              style={{
                paddingLeft: `${Math.min(task.parents.length, 3) * 12 + 4}px`,
              }}
            >
              <span
                className={cn(
                  "relative z-10 mt-1.5 h-2 w-2 rounded-full ring-4 ring-background",
                  task.status === "done"
                    ? "bg-emerald-500"
                    : task.status === "running"
                      ? "bg-sky-500"
                      : task.status === "blocked"
                        ? "bg-red-500"
                        : task.status === "review"
                          ? "bg-amber-500"
                          : "bg-muted-foreground/45",
                )}
              />
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <h4 className="min-w-0 flex-1 truncate text-xs font-medium">
                    {task.title}
                  </h4>
                  <KanbanStatusBadge status={task.status} />
                </div>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                  {task.assignee && <span>{task.assignee}</span>}
                  <code className="truncate opacity-65">{task.id}</code>
                </div>
                {task.latest_summary && (
                  <p className="mt-1.5 line-clamp-3 text-[11px] leading-4 text-muted-foreground">
                    {task.latest_summary}
                  </p>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}

export function WorkspacePane({ visible = true }: { visible?: boolean }) {
  const pane = useWorkspacePane();
  const { t } = useT();
  const [sessionTasks, setSessionTasks] = useState<HermesKanbanTask[]>([]);
  const [showCollaboration, setShowCollaboration] = useState(false);
  const widthRef = useRef(pane.width);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  widthRef.current = pane.width;

  useEffect(
    () => () => {
      resizeCleanupRef.current?.();
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    if (!visible || !pane.open || !pane.sessionId) {
      setSessionTasks([]);
      setShowCollaboration(false);
      return;
    }
    const refreshTasks = async () => {
      const result = await getHermesKanbanTasks({
        sessionId: pane.sessionId,
      });
      if (cancelled || !result.ok) return;
      setSessionTasks(result.tasks);
    };
    void refreshTasks();
    const timer = window.setInterval(() => void refreshTasks(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pane.open, pane.sessionId, visible]);

  useEffect(() => {
    if (sessionTasks.length > 0 && pane.tabs.length === 0) {
      setShowCollaboration(true);
    }
    if (sessionTasks.length === 0) {
      setShowCollaboration(false);
    }
  }, [pane.tabs.length, sessionTasks.length]);

  const onResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const handle = event.currentTarget;
      const container = containerRef.current;
      const preview = previewRef.current;
      if (!container || !preview) return;

      resizeCleanupRef.current?.();
      handle.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startWidth = widthRef.current;
      const previousCursor = document.documentElement.style.cursor;
      const previousUserSelect = document.documentElement.style.userSelect;
      let nextWidth = startWidth;

      container.style.transition = "none";
      preview.style.transition = "none";
      document.documentElement.style.cursor = "col-resize";
      document.documentElement.style.userSelect = "none";

      const onMove = (moveEvent: PointerEvent) => {
        moveEvent.preventDefault();
        nextWidth = clampPaneWidth(startWidth - (moveEvent.clientX - startX));
        container.style.width = `${nextWidth}px`;
        preview.style.width = `${nextWidth}px`;
      };

      let finished = false;
      const finish = (commit: boolean) => {
        if (finished) return;
        finished = true;
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        document.documentElement.style.cursor = previousCursor;
        document.documentElement.style.userSelect = previousUserSelect;
        resizeCleanupRef.current = null;

        if (commit) {
          widthRef.current = nextWidth;
          pane.setWidth(nextWidth);
          void getPlatform().storage.set({ [PANE_WIDTH_KEY]: nextWidth });
          requestAnimationFrame(() => {
            if (!container.isConnected || !preview.isConnected) return;
            container.style.removeProperty("transition");
            preview.style.removeProperty("transition");
          });
        } else {
          container.style.removeProperty("transition");
          preview.style.removeProperty("transition");
        }
      };
      const onUp = () => {
        finish(true);
      };

      resizeCleanupRef.current = () => finish(false);
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    },
    [pane.setWidth],
  );

  if (!visible || !pane.enabled) return null;
  const active = pane.activeTab;

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative min-h-0 shrink-0 self-stretch transition-[width] duration-200 ease-out motion-reduce:transition-none",
        pane.open ? "max-[1100px]:!w-1/2" : "max-[1100px]:!w-0",
        !pane.open && "pointer-events-none",
      )}
      style={{ width: pane.open ? pane.width : 0 }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("workspacePane.resize")}
        onPointerDown={onResizeStart}
        className={cn(
          "group absolute inset-y-0 left-0 z-40 w-1 -translate-x-1/2 cursor-col-resize touch-none transition-opacity duration-150 motion-reduce:transition-none max-[1100px]:hidden",
          pane.open ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="absolute inset-y-0 left-1/2 w-px bg-border/35 transition-colors group-hover:bg-foreground/10 group-active:bg-foreground/20" />
      </div>
      <aside
        ref={previewRef}
        aria-label={t("workspacePane.title")}
        aria-hidden={!pane.open}
        className={cn(
          "absolute inset-y-0 right-0 flex h-full min-h-0 flex-col overflow-hidden bg-background transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none",
          "max-[1100px]:!w-full max-[1100px]:!max-w-none",
          pane.open ? "translate-x-0 opacity-100" : "translate-x-4 opacity-0",
        )}
        style={{
          width: pane.width,
          maxWidth: "calc(100vw - 52px)",
        }}
      >
        <div
          data-workspace-tabbar
          className="flex h-11 shrink-0 items-center bg-background pl-2 pr-11"
        >
          {pane.tabs.length > 0 || sessionTasks.length > 0 ? (
            <div
              role="tablist"
              aria-label={t("workspacePane.title")}
              className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto"
            >
              {sessionTasks.length > 0 && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={showCollaboration}
                  onClick={() => setShowCollaboration(true)}
                  className={cn(
                    "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[11px] transition-colors",
                    showCollaboration
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <GitBranch className="h-3.5 w-3.5" />
                  {t("workspacePane.collaboration")}
                  <span className="tabular-nums opacity-60">
                    {sessionTasks.length}
                  </span>
                </button>
              )}
              {pane.tabs.map((tab) => {
                const selected = tab.id === active?.id;
                const labels =
                  tab.resource.kind === "diff"
                    ? { primary: t("workspacePane.review"), context: "" }
                    : resourceTabLabels(tab.resource);
                return (
                  <WorkspaceTabButton
                    key={tab.id}
                    tab={tab}
                    selected={selected}
                    labels={labels}
                    onSelect={() => {
                      setShowCollaboration(false);
                      pane.selectTab(tab.id);
                    }}
                    onClose={() => pane.closeTab(tab.id)}
                  />
                );
              })}
            </div>
          ) : (
            <div className="min-w-0 flex-1 truncate px-2 text-[11px] font-medium text-muted-foreground/70">
              {t("workspacePane.title")}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1">
          {showCollaboration ? (
            <SessionTaskFlow tasks={sessionTasks} />
          ) : !active ? (
            <WorkspaceEmptyState />
          ) : active.resource.kind === "file" && pane.files ? (
            <WorkspaceFileView
              resource={active.resource}
              sessionId={pane.sessionId}
              files={pane.files}
            />
          ) : active.resource.kind === "code" ? (
            <CodeExecutionView resource={active.resource} />
          ) : active.resource.kind === "diff" ? (
            <DiffView
              resource={active.resource}
              onOpenFile={pane.openFile}
              sessionId={pane.sessionId}
              files={pane.files}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {t("workspacePane.fileUnavailable")}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
