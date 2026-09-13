import { useDirectoryChooser } from "../directory-chooser";
import { EmptyStateVisual } from "../primitives/empty-state-visual";
import {
  WorkbenchResourceView,
  useWorkbenchExtensions,
  selectWorkbenchView,
} from "./workbench-extensions";
import { ChatMarkdown } from "@amiba/markdown";
import type {
  WorkbenchResource,
  WorkbenchViewExtension,
  WorkbenchViewProps,
  WorkbenchPanelOwner,
} from "@amiba/extension-sdk";
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
import { type ToolProgress } from "@amiba/app-runtime/core";
import { useT } from "@amiba/i18n";
import {
  getPlatform,
  type WorkspaceAdapter,
  type WorkspaceCheckpoint,
  type WorkspaceDevelopmentAdapter,
  type WorkspaceFilesAdapter,
  type WorkspaceGitState,
  type WorkspaceProject,
  type WorkspaceTerminalSnapshot,
  type WorkspaceTreeEntry,
} from "@amiba/app-runtime/platform";
import {
  Atom,
  Braces,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Code2,
  CodeXml,
  Columns2,
  Copy,
  File,
  ExternalLink,
  FileCode2,
  FileDiff,
  FileText,
  FolderOpen,
  FolderTree,
  GitBranch,
  GitCommitHorizontal,
  Hash,
  History,
  List,
  MoreHorizontal,
  PanelBottom,
  PanelRight,
  Plus,
  RotateCw,
  Search,
  Send,
  Terminal,
  Trash2,
  Undo2,
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
  type UIEvent as ReactUIEvent,
} from "react";
import { tags } from "@lezer/highlight";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XtermTerminal } from "@xterm/xterm";

import {
  Button,
  CascadeMenu,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  cn,
} from "../primitives";
import type { WorkspaceInspectorCapability } from "./internal/capabilities";
import { formatToolDuration } from "./internal/helpers";
import { useHorizontalWheelScroll } from "../hooks/useHorizontalWheelScroll";
import { useDocumentTheme } from "../theme";
import {
  compactWorkspacePath,
  parseWorkspaceReview,
  workspaceFileTargets,
  workspaceTabLabel,
  type WorkspaceReviewResource,
  type WorkspaceReviewEntry,
  type WorkspaceReviewFile,
  type WorkspaceReviewGap,
  type WorkspaceReviewLine,
  type WorkspaceReviewRow,
} from "./workspace-review";
import { workspaceTerminalTheme } from "./workspace-terminal-theme";

export { workspaceFileTargets } from "./workspace-review";

const PANE_WIDTH_KEY = "settings.chat.workspacePaneWidth";
const TERMINAL_HEIGHT_KEY = "settings.chat.workspaceTerminalHeight";
const DEFAULT_PANE_WIDTH = 520;
const MIN_PANE_WIDTH = 360;
const MAX_PANE_WIDTH = 880;
const DEFAULT_TERMINAL_HEIGHT = 280;
const MIN_TERMINAL_HEIGHT = 160;
const MAX_TERMINAL_HEIGHT = 640;

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

export type FileResource = {
  kind: "file";
  path: string;
  line?: number;
  sourceToolCallId?: string;
};

type DiffResource = WorkspaceReviewResource;

export type CodeExecutionResource = {
  kind: "code";
  toolCallId: string;
  language: string;
  code: string;
  output: string;
  workdir: string;
  exitCode: number | null;
  failed: boolean;
  status: ToolProgress["status"];
  durationMs?: number;
};

export type WorkspacePaneResource =
  | FileResource
  | DiffResource
  | CodeExecutionResource
  | { kind: "extension"; resource: WorkbenchResource };

interface WorkspacePaneTab {
  id: string;
  resource: WorkspacePaneResource;
  pinned: boolean;
}

type WorkbenchMode =
  | "files"
  | "checkpoints"
  | "preview"
  | `extension:${string}`
  | `view:${string}`;

/**
 * Everything the workbench remembers is owned by ONE session: its tabs, whether
 * the pane is open, which view it shows, whether the file tree is unfolded and
 * whether the terminal drawer is out. Switching sessions swaps the whole
 * record — nothing here is a global preference (the pane WIDTH is the one
 * layout setting shared across sessions).
 */
interface SessionPaneState {
  tabs: WorkspacePaneTab[];
  activeTabId: string | null;
  open: boolean;
  mode: WorkbenchMode;
  fileTreeOpen: boolean;
  terminalOpen: boolean;
}

interface WorkspacePaneContextValue {
  enabled: boolean;
  open: boolean;
  width: number;
  tabs: WorkspacePaneTab[];
  activeTab: WorkspacePaneTab | null;
  mode: WorkbenchMode;
  fileTreeOpen: boolean;
  terminalOpen: boolean;
  sessionId: string;
  files?: WorkspaceFilesAdapter;
  development?: WorkspaceDevelopmentAdapter;
  workspaces?: WorkspaceAdapter;
  checkpoints: WorkspaceCheckpoint[];
  setOpen(open: boolean): void;
  toggle(): void;
  setWidth(width: number): void;
  setMode(mode: WorkbenchMode): void;
  setFileTreeOpen(open: boolean): void;
  setTerminalOpen(open: boolean): void;
  selectTab(id: string): void;
  closeTab(id: string): void;
  openUrl(url: string): boolean;
  resources: readonly { sessionId: string; resource: WorkbenchResource }[];
  openResourceIn(sessionId: string, resource: WorkbenchResource): void;
  updateResourceIn(
    sessionId: string,
    type: string,
    id: string,
    update: (resource: WorkbenchResource) => WorkbenchResource,
  ): void;
  focusResourceIn(sessionId: string, type: string, id: string): void;
  openResource(resource: WorkbenchResource): void;
  openFile(path: string, line?: number): void;
  openReview(resource: WorkspaceReviewResource): void;
  beginTurn(turnIndex: number): Promise<void>;
  /** Prepare the addressed workspace without selecting it or opening its pane. */
  beginTurnFor(sessionId: string, turnIndex: number): Promise<void>;
  refreshCheckpoints(): Promise<void>;
  restoreCheckpoint(checkpointId: string): Promise<void>;
  restoreBeforeTurn(turnIndex: number): Promise<void>;
  deleteCheckpoint(checkpointId: string): Promise<void>;
  canOpenToolEvent(event: ToolProgress): boolean;
  openToolEvent(event: ToolProgress): void;
  observeToolEvent(event: ToolProgress, eventSessionId?: string): void;
}

const EMPTY_CONTEXT: WorkspacePaneContextValue = {
  enabled: false,
  open: false,
  width: DEFAULT_PANE_WIDTH,
  tabs: [],
  activeTab: null,
  mode: "files",
  fileTreeOpen: false,
  terminalOpen: false,
  sessionId: "",
  development: undefined,
  workspaces: undefined,
  checkpoints: [],
  setOpen: () => {},
  toggle: () => {},
  setWidth: () => {},
  setMode: () => {},
  setFileTreeOpen: () => {},
  setTerminalOpen: () => {},
  selectTab: () => {},
  closeTab: () => {},
  openUrl: () => false,
  resources: [],
  openResourceIn: () => {},
  updateResourceIn: () => {},
  focusResourceIn: () => {},
  openResource: () => {},
  openFile: () => {},
  openReview: () => {},
  beginTurn: async () => {},
  beginTurnFor: async () => {},
  refreshCheckpoints: async () => {},
  restoreCheckpoint: async () => {},
  restoreBeforeTurn: async () => {},
  deleteCheckpoint: async () => {},
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
  event: ToolProgress,
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
    // DSH execute_code may omit a language field when it runs Python.
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

export function canInspectWorkspaceTool(event: ToolProgress): boolean {
  // Official DSH wire names: the fs tools plus the (currently uncomposed)
  // code runtime — the pane's own capability vocabulary, not presentation.
  return (
    event.tool === "read" ||
    event.tool === "edit" ||
    event.tool === "write" ||
    event.tool === "execute_code"
  );
}

function isMutationTool(event: ToolProgress): boolean {
  return event.tool === "edit" || event.tool === "write";
}

export function canMutateWorkspaceTool(event: ToolProgress): boolean {
  return (
    isMutationTool(event) ||
    event.tool === "bash" ||
    event.tool === "execute_code"
  );
}

function resourceTitle(resource: WorkspacePaneResource): string {
  if (resource.kind === "extension") return resource.resource.title;
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
  const extensions = useWorkbenchExtensions();
  if (resource.kind === "extension") {
    const Icon = selectWorkbenchView(extensions, resource.resource.type)?.tabIcon;
    return Icon ? <Icon resource={resource.resource} className={className} /> : <File className={className} aria-hidden />;
  }
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
        // A pill, not a rounded box: `rounded-full` with asymmetric padding —
        // roomy on the icon side, tight on the close side so the × sits just
        // inside the curve instead of floating in a gutter.
        "group/tab flex h-7 max-w-[184px] shrink-0 items-center rounded-full pl-2 pr-1 transition-colors duration-150",
        selected
          ? "bg-muted/70 text-foreground"
          : "text-muted-foreground/80 hover:bg-muted/35 hover:text-foreground/85",
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={selected}
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-1.5 pr-0.5"
        title={
          tab.resource.kind === "file" ? tab.resource.path : labels.primary
        }
      >
        <WorkspaceTabIcon
          resource={tab.resource}
          className="h-3.5 w-3.5 shrink-0"
        />
        <span className="min-w-0 truncate text-[11px] font-medium tracking-[-0.01em]">
          {labels.primary}
        </span>
        {labels.context && (
          <span
            className={cn(
              "shrink truncate text-[9px] font-normal text-muted-foreground/55",
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
          "inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-muted-foreground/60 transition-[color,background-color,opacity] hover:bg-foreground/[0.06] hover:text-foreground focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
          selected ? "opacity-65" : "opacity-0 group-hover/tab:opacity-65",
        )}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function resourceKey(resource: WorkspacePaneResource): string {
  if (resource.kind === "extension")
    return `extension:${JSON.stringify([resource.resource.type, resource.resource.id])}`;
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

function clampTerminalHeight(value: number): number {
  const viewportMaximum =
    typeof window === "undefined"
      ? MAX_TERMINAL_HEIGHT
      : Math.max(
          MIN_TERMINAL_HEIGHT,
          Math.min(MAX_TERMINAL_HEIGHT, window.innerHeight - 160),
        );
  return Math.min(
    viewportMaximum,
    Math.max(MIN_TERMINAL_HEIGHT, Math.round(value)),
  );
}

function emptySessionState(): SessionPaneState {
  return {
    tabs: [],
    activeTabId: null,
    open: false,
    mode: "files",
    fileTreeOpen: false,
    terminalOpen: false,
  };
}

const EMPTY_SESSION_KEY = "__empty_workspace__";

export function WorkspacePaneProvider({
  capability,
  sessionId,
  children,
}: {
  capability?: WorkspaceInspectorCapability;
  sessionId: string;
  children: ReactNode;
}) {
  const [width, setWidthState] = useState(DEFAULT_PANE_WIDTH);
  const [sessionStates, setSessionStates] = useState<
    Record<string, SessionPaneState>
  >({});
  const [checkpointStates, setCheckpointStates] = useState<
    Record<string, WorkspaceCheckpoint[]>
  >({});
  const activeTurnCheckpointIds = useRef(new Map<string, string>());
  const checkpointAttempts = useRef(new Map<string, object>());
  const markedCheckpointIds = useRef(new Set<string>());
  const extensions = useWorkbenchExtensions();
  const enabled = Boolean(sessionId && (capability || extensions.length));
  const stateKey = sessionId || EMPTY_SESSION_KEY;
  const activeState = sessionStates[stateKey] ?? emptySessionState();
  const open = activeState.open;
  const checkpoints = checkpointStates[sessionId] ?? [];
  const activeTab =
    activeState.tabs.find((tab) => tab.id === activeState.activeTabId) ?? null;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const storage = getPlatform().storage;
    void storage.get(PANE_WIDTH_KEY).then((result) => {
      if (cancelled) return;
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
  }, [enabled]);

  /**
   * Update ONE named session's workbench record.
   *
   * Browser tabs arrive from Electron main with the session that owns them,
   * which is not necessarily the session on screen: a background task must
   * write into its own record, never the one the user is looking at.
   */
  const updateSession = useCallback(
    (
      targetSessionId: string,
      updater: (state: SessionPaneState) => SessionPaneState,
    ) => {
      const key = targetSessionId || EMPTY_SESSION_KEY;
      setSessionStates((current) => ({
        ...current,
        [key]: updater(current[key] ?? emptySessionState()),
      }));
    },
    [],
  );

  const updateActiveSession = useCallback(
    (updater: (state: SessionPaneState) => SessionPaneState) => {
      updateSession(stateKey, updater);
    },
    [stateKey, updateSession],
  );

  const updateSessionCheckpoints = useCallback(
    (
      targetSessionId: string,
      updater: (checkpoints: WorkspaceCheckpoint[]) => WorkspaceCheckpoint[],
    ) => {
      if (!targetSessionId) return;
      setCheckpointStates((current) => ({
        ...current,
        [targetSessionId]: updater(current[targetSessionId] ?? []),
      }));
    },
    [],
  );

  const updateCheckpoints = useCallback(
    (
      updater: (checkpoints: WorkspaceCheckpoint[]) => WorkspaceCheckpoint[],
    ) => {
      updateSessionCheckpoints(sessionId, updater);
    },
    [sessionId, updateSessionCheckpoints],
  );

  const refreshCheckpoints = useCallback(async () => {
    const development = capability?.development;
    if (!development || !sessionId) return;
    const next = await development.listCheckpoints(sessionId);
    updateCheckpoints(() => next);
  }, [capability?.development, sessionId, updateCheckpoints]);

  useEffect(() => {
    if (!capability?.development || !sessionId) return;
    void refreshCheckpoints().catch(() => updateCheckpoints(() => []));
  }, [
    capability?.development,
    refreshCheckpoints,
    sessionId,
    updateCheckpoints,
  ]);

  const restoreCheckpoint = useCallback(
    async (checkpointId: string) => {
      const development = capability?.development;
      if (!development || !sessionId) return;
      await development.restoreCheckpoint(sessionId, checkpointId);
      await refreshCheckpoints();
    },
    [capability?.development, refreshCheckpoints, sessionId],
  );

  const restoreBeforeTurn = useCallback(
    async (turnIndex: number) => {
      const checkpoint = checkpoints.find(
        (item) =>
          item.kind === "turn-start" &&
          item.turnIndex === turnIndex &&
          item.hasChanges &&
          item.complete !== false,
      );
      if (!checkpoint) throw new Error("Recovery point is unavailable.");
      await restoreCheckpoint(checkpoint.id);
    },
    [checkpoints, restoreCheckpoint],
  );

  const deleteCheckpoint = useCallback(
    async (checkpointId: string) => {
      const development = capability?.development;
      if (!development || !sessionId) return;
      await development.deleteCheckpoint(sessionId, checkpointId);
      updateCheckpoints((current) =>
        current.filter((item) => item.id !== checkpointId),
      );
    },
    [capability?.development, sessionId, updateCheckpoints],
  );

  const persistOpen = useCallback(
    (next: boolean) => {
      updateActiveSession((state) =>
        state.open === next ? state : { ...state, open: next },
      );
    },
    [updateActiveSession],
  );
  const setMode = useCallback(
    (mode: WorkbenchMode) => {
      updateActiveSession((state) =>
        state.mode === mode ? state : { ...state, mode },
      );
    },
    [updateActiveSession],
  );
  const setFileTreeOpen = useCallback(
    (fileTreeOpen: boolean) => {
      updateActiveSession((state) =>
        state.fileTreeOpen === fileTreeOpen
          ? state
          : { ...state, fileTreeOpen },
      );
    },
    [updateActiveSession],
  );
  const setTerminalOpen = useCallback(
    (terminalOpen: boolean) => {
      updateActiveSession((state) =>
        state.terminalOpen === terminalOpen
          ? state
          : { ...state, terminalOpen },
      );
    },
    [updateActiveSession],
  );

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
      if (!sessionId) return;
      updateActiveSession((state) => {
        const nextResourceKey = resourceKey(resource);
        const existing = state.tabs.find(
          (tab) => resourceKey(tab.resource) === nextResourceKey,
        );
        if (existing) {
          const existingEntries =
            existing.resource.kind === "diff" ? existing.resource.entries : [];
          const mergedDiffEntries =
            existing.resource.kind === "diff" && resource.kind === "diff"
              ? [
                  ...new Map(
                    [...existingEntries, ...resource.entries].map((entry) => [
                      entry.toolCallId,
                      entry,
                    ]),
                  ).values(),
                ]
              : [];
          const nextResource =
            existing.resource.kind === "diff" && resource.kind === "diff"
              ? {
                  ...resource,
                  entries: mergedDiffEntries,
                }
              : resource;
          return {
            ...state,
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
            mode: "preview",
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
            return {
              ...state,
              tabs,
              activeTabId: previewTab.id,
              mode: "preview",
            };
          }
          return {
            ...state,
            tabs: [...state.tabs, previewTab],
            activeTabId: previewTab.id,
            mode: "preview",
          };
        }

        const tab: WorkspacePaneTab = {
          id: nextResourceKey,
          resource,
          pinned: true,
        };
        const tabs = [...state.tabs, tab].slice(-10);
        return { ...state, tabs, activeTabId: tab.id, mode: "preview" };
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

  const openReview = useCallback(
    (resource: WorkspaceReviewResource) => openResource(resource, "user"),
    [openResource],
  );

  const resources = useMemo(
    () =>
      Object.entries(sessionStates).flatMap(([key, state]) =>
        state.tabs.map((tab) => ({
          sessionId: key === EMPTY_SESSION_KEY ? "" : key,
          resource: toWorkbenchResource(tab.resource),
        })),
      ),
    [sessionStates],
  );

  const openResourceIn = useCallback(
    (owner: string, resource: WorkbenchResource) => {
      updateSession(owner, (state) => {
        const wrapped: WorkspacePaneResource = { kind: "extension", resource };
        const id = resourceKey(wrapped);
        const existing = state.tabs.find((tab) => tab.id === id);
        return {
          ...state,
          tabs: existing
            ? state.tabs
            : [...state.tabs, { id, resource: wrapped, pinned: true }],
          activeTabId: id,
          mode: "preview",
          open: true,
        };
      });
    },
    [updateSession],
  );

  const updateResourceIn = useCallback(
    (
      owner: string,
      type: string,
      id: string,
      update: (resource: WorkbenchResource) => WorkbenchResource,
    ) => {
      updateSession(owner, (state) => ({
        ...state,
        tabs: state.tabs.map((tab) => {
          if (
            tab.resource.kind !== "extension" ||
            tab.resource.resource.type !== type ||
            tab.resource.resource.id !== id
          )
            return tab;
          const next = update(tab.resource.resource);
          // Updates cannot move a resource between identities or sessions.
          return {
            ...tab,
            resource: {
              kind: "extension" as const,
              resource: { ...next, type, id },
            },
          };
        }),
      }));
    },
    [updateSession],
  );

  const focusResourceIn = useCallback(
    (owner: string, type: string, id: string) => {
      updateSession(owner, (state) => {
        const tab = state.tabs.find((tab) => {
          const resource = toWorkbenchResource(tab.resource);
          return resource.type === type && resource.id === id;
        });
        return tab
          ? { ...state, activeTabId: tab.id, mode: "preview", open: true }
          : state;
      });
    },
    [updateSession],
  );

  const openUrl = useCallback(
    (url: string) => {
      const current = resources
        .filter((entry) => entry.sessionId === sessionId)
        .map((entry) => entry.resource);
      for (const extension of [...extensions].sort(
        (a, b) => a.order - b.order || a.id.localeCompare(b.id),
      )) {
        if (
          selectWorkbenchView(extensions, extension.resourceType) !== extension
        )
          continue;
        const resource = extension.resolveUrl?.(url, current);
        if (resource) {
          openResourceIn(sessionId, resource);
          return true;
        }
      }
      return false;
    },
    [extensions, resources, sessionId, openResourceIn],
  );

  const beginTurnFor = useCallback(
    async (targetSessionId: string, turnIndex: number) => {
      if (!targetSessionId) return;
      const development = capability?.development;
      if (development) {
        const attempt = {};
        checkpointAttempts.current.set(targetSessionId, attempt);
        const latest = () => checkpointAttempts.current.get(targetSessionId) === attempt;
        try {
          const checkpoint = await development.createCheckpoint(
            targetSessionId,
            `Before task ${turnIndex + 1}`,
            { kind: "turn-start", turnIndex },
          );
          if (!checkpoint) {
            // Workspace isn't a Git repository — checkpoints simply don't
            // apply to this session.
            if (latest()) activeTurnCheckpointIds.current.delete(targetSessionId);
            return;
          }
          if (latest()) activeTurnCheckpointIds.current.set(targetSessionId, checkpoint.id);
          updateSessionCheckpoints(targetSessionId, (current) => [
            checkpoint,
            ...current.filter((item) => item.id !== checkpoint.id),
          ]);
        } catch {
          if (latest()) activeTurnCheckpointIds.current.delete(targetSessionId);
        } finally {
          if (latest()) checkpointAttempts.current.delete(targetSessionId);
        }
      }
    },
    [capability?.development, updateSessionCheckpoints],
  );
  const beginTurn = useCallback((turnIndex: number) => beginTurnFor(sessionId, turnIndex), [beginTurnFor, sessionId]);

  const markActiveCheckpointChanged = useCallback(
    (targetSessionId: string) => {
      const development = capability?.development;
      const checkpointId = activeTurnCheckpointIds.current.get(targetSessionId);
      if (
        !development ||
        !checkpointId ||
        markedCheckpointIds.current.has(checkpointId)
      ) {
        return;
      }
      markedCheckpointIds.current.add(checkpointId);
      void development
        .markCheckpointChanged(targetSessionId, checkpointId)
        .then((checkpoint) => {
          markedCheckpointIds.current.delete(checkpointId);
          updateSessionCheckpoints(targetSessionId, (current) =>
            current.map((item) =>
              item.id === checkpoint.id ? checkpoint : item,
            ),
          );
        })
        .catch(() => markedCheckpointIds.current.delete(checkpointId));
    },
    [capability?.development, updateSessionCheckpoints],
  );

  const canOpenToolEvent = useCallback(
    (event: ToolProgress) =>
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
    (event: ToolProgress) => {
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
    (event: ToolProgress, eventSessionId = sessionId) => {
      const targetSessionId = eventSessionId || sessionId;
      if (event.status === "completed" && canMutateWorkspaceTool(event)) {
        markActiveCheckpointChanged(targetSessionId);
      }
      if (targetSessionId !== sessionId) return;
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
      }
    },
    [capability, markActiveCheckpointChanged, sessionId, updateActiveSession],
  );

  const value = useMemo<WorkspacePaneContextValue>(
    () => ({
      enabled,
      open: enabled && open,
      width,
      tabs: activeState.tabs,
      activeTab,
      mode: activeState.mode,
      fileTreeOpen: activeState.fileTreeOpen,
      terminalOpen: activeState.terminalOpen,
      sessionId,
      files: capability?.files,
      development: capability?.development,
      workspaces: capability?.workspaces,
      checkpoints,
      setOpen: persistOpen,
      toggle: () => persistOpen(!open),
      setWidth,
      setMode,
      setFileTreeOpen,
      setTerminalOpen,
      selectTab: (id) =>
        updateActiveSession((state) => ({
          ...state,
          activeTabId: id,
          mode: "preview",
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
          return { ...state, tabs, activeTabId: fallback?.id ?? null };
        }),
      openUrl,
      resources,
      openResourceIn,
      updateResourceIn,
      focusResourceIn,
      openResource: (resource) => openResourceIn(sessionId, resource),
      openFile,
      openReview,
      beginTurn,
      beginTurnFor,
      refreshCheckpoints,
      restoreCheckpoint,
      restoreBeforeTurn,
      deleteCheckpoint,
      canOpenToolEvent,
      openToolEvent,
      observeToolEvent,
    }),
    [
      openResource,
      openUrl,
      resources,
      openResourceIn,
      updateResourceIn,
      focusResourceIn,
      activeState.tabs,
      activeState.mode,
      activeState.fileTreeOpen,
      activeState.terminalOpen,
      activeTab,
      beginTurn,
      beginTurnFor,
      canOpenToolEvent,
      capability,
      checkpoints,
      deleteCheckpoint,
      enabled,
      observeToolEvent,
      open,
      openFile,
      openReview,
      openToolEvent,
      persistOpen,
      refreshCheckpoints,
      restoreBeforeTurn,
      restoreCheckpoint,
      sessionId,
      setFileTreeOpen,
      setMode,
      setTerminalOpen,
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

export function WorkspacePaneToggle({
  className,
  onBeforeToggle,
  showUnavailable = false,
}: {
  className?: string;
  onBeforeToggle?: () => void;
  showUnavailable?: boolean;
}) {
  const pane = useWorkspacePane();
  const { t } = useT();
  if (!pane.enabled && !showUnavailable) return null;
  return (
    <button
      type="button"
      disabled={!pane.enabled}
      onClick={() => {
        if (!pane.enabled) return;
        onBeforeToggle?.();
        pane.toggle();
      }}
      title={pane.open ? t("workspacePane.collapse") : t("workspacePane.open")}
      aria-label={
        pane.open ? t("workspacePane.collapse") : t("workspacePane.open")
      }
      aria-pressed={pane.open}
      aria-keyshortcuts="Meta+Shift+Backslash Control+Shift+Backslash"
      className={cn(
        "app-no-drag relative inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors",
        "hover:bg-foreground/5 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        "disabled:pointer-events-none disabled:opacity-30",
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

export function PreviewHeader({
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

export function CodeEditor({
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
      <span className="agent-thinking-dot" />
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

type ReviewViewMode = "unified" | "split";

function unifiedLineNumber(line: WorkspaceReviewLine): number | null {
  if (line.kind === "deletion") return line.oldLine;
  return line.newLine ?? line.oldLine;
}

function ReviewUnifiedCodeRow({ line }: { line: WorkspaceReviewLine }) {
  if (line.kind === "meta") {
    return (
      <div
        data-review-row="unified"
        className="grid min-w-full grid-cols-[48px_minmax(320px,1fr)] bg-muted/18 text-muted-foreground/55"
      >
        <span />
        <span className="px-3 py-0.5">{line.content}</span>
      </div>
    );
  }

  return (
    <div
      data-review-row="unified"
      className={cn(
        "grid min-w-full grid-cols-[48px_minmax(320px,1fr)]",
        line.kind === "addition" &&
          "bg-emerald-500/[0.11] text-emerald-950 dark:text-emerald-50",
        line.kind === "deletion" &&
          "bg-red-500/[0.1] text-red-950 dark:text-red-50",
      )}
    >
      <span
        data-review-line-number
        className={cn(
          "select-none border-r border-border/20 pr-2 text-right text-muted-foreground/42",
          line.kind === "deletion" && "border-l-2 border-l-red-500",
          line.kind === "addition" && "border-l-2 border-l-emerald-500",
        )}
      >
        {unifiedLineNumber(line) ?? ""}
      </span>
      <span className="whitespace-pre px-3">{line.content || " "}</span>
    </div>
  );
}

interface ReviewSplitLineRow {
  kind: "line";
  oldLine: WorkspaceReviewLine | null;
  newLine: WorkspaceReviewLine | null;
}

type ReviewSplitRow =
  | ReviewSplitLineRow
  | WorkspaceReviewGap
  | WorkspaceReviewLine;

function splitReviewRows(rows: WorkspaceReviewRow[]): ReviewSplitRow[] {
  const result: ReviewSplitRow[] = [];
  let index = 0;

  while (index < rows.length) {
    const row = rows[index]!;
    if (row.kind === "gap" || row.kind === "meta") {
      result.push(row);
      index += 1;
      continue;
    }
    if (row.kind === "context") {
      result.push({ kind: "line", oldLine: row, newLine: row });
      index += 1;
      continue;
    }

    const deletions: WorkspaceReviewLine[] = [];
    const additions: WorkspaceReviewLine[] = [];
    while (index < rows.length) {
      const change = rows[index]!;
      if (change.kind === "deletion") deletions.push(change);
      else if (change.kind === "addition") additions.push(change);
      else break;
      index += 1;
    }
    const lineCount = Math.max(deletions.length, additions.length);
    for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
      result.push({
        kind: "line",
        oldLine: deletions[lineIndex] ?? null,
        newLine: additions[lineIndex] ?? null,
      });
    }
  }

  return result;
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
        className="grid min-w-full grid-cols-[48px_minmax(320px,1fr)] bg-muted/45 text-left text-[10px] text-muted-foreground transition-colors hover:bg-muted/65 hover:text-foreground disabled:cursor-default"
        title={error ? t("workspacePane.contextUnavailable") : undefined}
      >
        <span aria-hidden />
        <span className="inline-flex items-center gap-1.5 px-3 py-1">
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          <span>
            {loading
              ? t("common.loading")
              : t("workspacePane.unmodifiedLines", { count: gap.count })}
          </span>
        </span>
      </button>
      {expandedLines.map((line, index) => (
        <ReviewUnifiedCodeRow
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
        <div className="grid min-w-full grid-cols-[48px_minmax(320px,1fr)] bg-muted/30 text-[10px] text-muted-foreground">
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

interface ReviewSplitMoreRow {
  kind: "more";
  count: number;
  key: string;
}

type ReviewSplitDisplayRow = ReviewSplitRow | ReviewSplitMoreRow;

function reviewGapKey(gap: WorkspaceReviewGap): string {
  return `${gap.oldStart}:${gap.newStart}:${gap.count}`;
}

function ReviewSplitSideRow({
  row,
  side,
  filesAvailable,
  loadingGapKey,
  errorGapKeys,
  expandedGapKeys,
  onToggleGap,
}: {
  row: ReviewSplitDisplayRow;
  side: "old" | "new";
  filesAvailable: boolean;
  loadingGapKey: string | null;
  errorGapKeys: Set<string>;
  expandedGapKeys: Set<string>;
  onToggleGap(gap: WorkspaceReviewGap): void;
}) {
  const { t } = useT();

  if (row.kind === "gap") {
    const key = reviewGapKey(row);
    const loading = loadingGapKey === key;
    return (
      <button
        type="button"
        onClick={() => onToggleGap(row)}
        disabled={!filesAvailable || loading}
        className="grid min-w-full grid-cols-[48px_minmax(240px,1fr)] bg-muted/45 text-left text-[10px] text-muted-foreground transition-colors hover:bg-muted/65 hover:text-foreground disabled:cursor-default"
        title={
          errorGapKeys.has(key)
            ? t("workspacePane.contextUnavailable")
            : undefined
        }
      >
        <span aria-hidden />
        <span className="inline-flex items-center gap-1.5 px-3 py-1">
          {expandedGapKeys.has(key) ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          <span>
            {loading
              ? t("common.loading")
              : t("workspacePane.unmodifiedLines", { count: row.count })}
          </span>
        </span>
      </button>
    );
  }

  if (row.kind === "more") {
    return (
      <div className="grid min-w-full grid-cols-[48px_minmax(240px,1fr)] bg-muted/30 text-[10px] text-muted-foreground">
        <span />
        <span className="px-3 py-1">
          {t("workspacePane.moreUnmodifiedLines", { count: row.count })}
        </span>
      </div>
    );
  }

  if (row.kind === "meta") {
    return (
      <div className="grid min-w-full grid-cols-[48px_minmax(240px,1fr)] bg-muted/18 text-muted-foreground/55">
        <span />
        <span className="px-3 py-0.5">{row.content}</span>
      </div>
    );
  }

  if (row.kind !== "line") return null;

  const line = side === "old" ? row.oldLine : row.newLine;
  const lineNumber = side === "old" ? line?.oldLine : line?.newLine;
  return (
    <div
      data-review-row="split"
      data-review-side={side}
      className={cn(
        "grid min-w-full grid-cols-[48px_minmax(240px,1fr)]",
        line?.kind === "deletion" &&
          "bg-red-500/[0.1] text-red-950 dark:text-red-50",
        line?.kind === "addition" &&
          "bg-emerald-500/[0.11] text-emerald-950 dark:text-emerald-50",
        !line && "bg-muted/[0.08]",
      )}
    >
      <span
        data-review-line-number
        className={cn(
          "select-none border-r border-border/20 pr-2 text-right text-muted-foreground/42",
          line?.kind === "deletion" && "border-l-2 border-l-red-500",
          line?.kind === "addition" && "border-l-2 border-l-emerald-500",
        )}
      >
        {lineNumber ?? ""}
      </span>
      <span className="whitespace-pre px-3">{line?.content || " "}</span>
    </div>
  );
}

function ReviewSplitFileView({
  rows,
  filePath,
  sessionId,
  files,
}: {
  rows: ReviewSplitRow[];
  filePath: string;
  sessionId: string;
  files?: WorkspaceFilesAdapter;
}) {
  const { t } = useT();
  const [expandedGapKeys, setExpandedGapKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [loadingGapKey, setLoadingGapKey] = useState<string | null>(null);
  const [errorGapKeys, setErrorGapKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [content, setContent] = useState<string[] | null>(null);
  const scrollElementsRef = useRef<
    Record<"old" | "new", HTMLDivElement | null>
  >({
    old: null,
    new: null,
  });
  const programmaticScrollLeftRef = useRef<
    Record<"old" | "new", number | null>
  >({
    old: null,
    new: null,
  });

  const toggleGap = useCallback(
    async (gap: WorkspaceReviewGap) => {
      const key = reviewGapKey(gap);
      if (expandedGapKeys.has(key)) {
        setExpandedGapKeys((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
        return;
      }

      let availableContent = content;
      if (!availableContent && files) {
        setLoadingGapKey(key);
        setErrorGapKeys((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
        try {
          const document = await files.read(sessionId, filePath);
          if (document.binary) throw new Error("binary");
          availableContent = document.content.split(/\r?\n/);
          setContent(availableContent);
        } catch {
          setErrorGapKeys((current) => new Set(current).add(key));
          return;
        } finally {
          setLoadingGapKey(null);
        }
      }
      if (!availableContent) return;
      setExpandedGapKeys((current) => new Set(current).add(key));
    },
    [content, expandedGapKeys, filePath, files, sessionId],
  );

  const displayRows = useMemo(() => {
    const result: ReviewSplitDisplayRow[] = [];
    for (const row of rows) {
      result.push(row);
      if (row.kind !== "gap" || !expandedGapKeys.has(reviewGapKey(row))) {
        continue;
      }
      const visibleCount = Math.min(row.count, 200);
      const expandedLines = content?.slice(
        row.newStart - 1,
        row.newStart - 1 + visibleCount,
      );
      for (let index = 0; index < (expandedLines?.length ?? 0); index += 1) {
        const line: WorkspaceReviewLine = {
          kind: "context",
          content: expandedLines![index]!,
          oldLine: row.oldStart + index,
          newLine: row.newStart + index,
        };
        result.push({ kind: "line", oldLine: line, newLine: line });
      }
      if (row.count > visibleCount) {
        result.push({
          kind: "more",
          count: row.count - visibleCount,
          key: reviewGapKey(row),
        });
      }
    }
    return result;
  }, [content, expandedGapKeys, rows]);

  const syncHorizontalScroll = useCallback(
    (side: "old" | "new", event: ReactUIEvent<HTMLDivElement>) => {
      const source = event.currentTarget;
      const expected = programmaticScrollLeftRef.current[side];
      if (expected !== null && Math.abs(source.scrollLeft - expected) < 1) {
        programmaticScrollLeftRef.current[side] = null;
        return;
      }
      programmaticScrollLeftRef.current[side] = null;

      const otherSide = side === "old" ? "new" : "old";
      const target = scrollElementsRef.current[otherSide];
      if (!target || Math.abs(target.scrollLeft - source.scrollLeft) < 1)
        return;

      programmaticScrollLeftRef.current[otherSide] = source.scrollLeft;
      target.scrollLeft = source.scrollLeft;
      // Browsers clamp scrollLeft when the peer contains a shorter longest
      // line. Remember the actual value so its resulting scroll event cannot
      // pull the source pane backwards.
      programmaticScrollLeftRef.current[otherSide] = target.scrollLeft;
    },
    [],
  );

  return (
    <div
      data-review-layout="split"
      className="grid min-w-0 grid-cols-2 overflow-hidden font-mono text-[10.5px] leading-[1.65]"
    >
      {(["old", "new"] as const).map((side) => (
        <div
          key={side}
          data-review-split-pane={side}
          className={cn(
            "min-w-0 overflow-hidden",
            side === "old" && "border-r border-border/35",
          )}
        >
          <div className="border-b border-border/20 bg-muted/[0.14] py-1 pl-[60px] font-sans text-[9.5px] font-medium text-muted-foreground/70">
            {side === "old"
              ? t("workspacePane.beforeChange")
              : t("workspacePane.afterChange")}
          </div>
          <div
            ref={(element) => {
              scrollElementsRef.current[side] = element;
            }}
            data-review-scroll={side}
            onScroll={(event) => syncHorizontalScroll(side, event)}
            className="min-w-0 overflow-x-auto overscroll-x-contain"
          >
            <div className="w-max min-w-full">
              {displayRows.map((row, index) => (
                <ReviewSplitSideRow
                  key={`${side}:${row.kind}:${"key" in row ? row.key : index}`}
                  row={row}
                  side={side}
                  filesAvailable={Boolean(files)}
                  loadingGapKey={loadingGapKey}
                  errorGapKeys={errorGapKeys}
                  expandedGapKeys={expandedGapKeys}
                  onToggleGap={(gap) => void toggleGap(gap)}
                />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ReviewFileSection({
  file,
  collapsed,
  onToggle,
  onOpenFile,
  sessionId,
  files,
  viewMode,
}: {
  file: WorkspaceReviewFile;
  collapsed: boolean;
  onToggle(): void;
  onOpenFile(path: string): void;
  sessionId: string;
  files?: WorkspaceFilesAdapter;
  viewMode: ReviewViewMode;
}) {
  const { t } = useT();
  const splitRows = useMemo(() => splitReviewRows(file.rows), [file.rows]);

  return (
    <section className="min-w-0 overflow-hidden">
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
      {!collapsed &&
        (viewMode === "unified" ? (
          <div
            data-review-scroll="unified"
            className="min-w-0 overflow-x-auto overscroll-x-contain py-1 font-mono text-[10.5px] leading-[1.65]"
          >
            <div className="w-max min-w-full">
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
                  <ReviewUnifiedCodeRow
                    key={`${row.kind}:${row.oldLine}:${row.newLine}:${index}`}
                    line={row}
                  />
                ),
              )}
            </div>
          </div>
        ) : (
          <ReviewSplitFileView
            rows={splitRows}
            filePath={file.path}
            sessionId={sessionId}
            files={files}
          />
        ))}
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
  const [viewMode, setViewMode] = useState<ReviewViewMode>("unified");
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
          review.additions > 0 || review.deletions > 0 ? (
            <span className="flex items-center gap-1.5 font-mono text-[10px]">
              <span className="text-emerald-600 dark:text-emerald-400">
                +{review.additions}
              </span>
              <span className="text-red-600 dark:text-red-400">
                -{review.deletions}
              </span>
            </span>
          ) : null
        }
        actions={
          <div className="flex shrink-0 items-center gap-1.5">
            <div
              role="group"
              aria-label={t("workspacePane.diffViewMode")}
              className="flex h-7 items-center rounded-md bg-muted/45 p-0.5"
            >
              <button
                type="button"
                aria-label={t("workspacePane.unifiedDiff")}
                title={t("workspacePane.unifiedDiff")}
                aria-pressed={viewMode === "unified"}
                onClick={() => setViewMode("unified")}
                className={cn(
                  "inline-flex h-6 w-6 items-center justify-center rounded-[5px] text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
                  viewMode === "unified" &&
                    "bg-background text-foreground shadow-sm",
                )}
              >
                <List className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label={t("workspacePane.splitDiff")}
                title={t("workspacePane.splitDiff")}
                aria-pressed={viewMode === "split"}
                onClick={() => setViewMode("split")}
                className={cn(
                  "inline-flex h-6 w-6 items-center justify-center rounded-[5px] text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
                  viewMode === "split" &&
                    "bg-background text-foreground shadow-sm",
                )}
              >
                <Columns2 className="h-3.5 w-3.5" />
              </button>
            </div>
            {review.files.length > 1 ? (
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
            ) : null}
          </div>
        }
      />
      <div
        data-selection="text"
        className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-background"
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
              viewMode={viewMode}
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
        <EmptyStateVisual scene="workspace">
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
        </EmptyStateVisual>
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

function WorkspaceProjectStrip({
  sessionId,
  development,
  workspaces,
}: {
  sessionId: string;
  development?: WorkspaceDevelopmentAdapter;
  workspaces?: WorkspaceAdapter;
}) {
  const { t } = useT();
  const [project, setProject] = useState<WorkspaceProject | null>(null);
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!development) return;
    try {
      const ensured = await development.ensureProject(sessionId);
      setProject(ensured);
      const [allProjects, activePath] = await Promise.all([
        development.listProjects(),
        workspaces?.getCurrent(sessionId) ?? Promise.resolve(null),
      ]);
      setProjects(allProjects);
      setCurrentPath(activePath);
      setError(null);
    } catch (cause) {
      setProject(null);
      setProjects([]);
      setCurrentPath(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [development, sessionId, workspaces]);

  const mutate = useCallback(
    async (operation: () => Promise<unknown>, propagate = false) => {
      setBusy(true);
      setError(null);
      try {
        await operation();
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        if (propagate) throw cause;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const chooseDirectory = useDirectoryChooser("workspace");
  const chooseNewProject = useCallback(async () => {
    if (!chooseDirectory || !development) return;
    try {
      await chooseDirectory(project?.folders[0], async (path) => {
        await mutate(async () => {
          const created = await development.createProject("", [path]);
          await development.bindProjectLocation(sessionId, created.id, created.folders[0]!);
          setProjectMenuOpen(false);
        }, true);
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [chooseDirectory, development, mutate, project?.folders, sessionId]);

  const addFolder = useCallback(async () => {
    if (!chooseDirectory || !development || !project) return;
    try {
      await chooseDirectory(project.folders[0], async (path) => {
        await mutate(async () => {
          const updated = await development.addProjectFolder(project.id, path);
          await development.bindProjectLocation(sessionId, updated.id, path);
        }, true);
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [chooseDirectory, development, mutate, project, sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(
    () =>
      workspaces?.onChange((change) => {
        if (change.sessionId === sessionId) void refresh();
      }),
    [refresh, sessionId, workspaces],
  );

  if (!development) return null;
  const locationLabel = (path: string) =>
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || path;
  const isCurrent = (path: string) => currentPath === path;
  const locations = project
    ? [...new Set([...project.folders, ...(currentPath ? [currentPath] : [])])]
    : [];
  return (
    <div
      data-workspace-project-strip
      className="border-b border-border/35 px-3 py-2"
    >
      <div className="flex items-center gap-2">
        <FolderTree className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <Popover open={projectMenuOpen} onOpenChange={setProjectMenuOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1 rounded-md text-left text-xs font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/35"
              aria-label={t("workspacePane.switchProject")}
              aria-haspopup="menu"
            >
              <span className="truncate">
                {project?.name ?? t("workspacePane.project")}
              </span>
              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            role="menu"
            side="bottom"
            size="compact"
          >
            <p className="px-2.5 pb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("workspacePane.projects")}
            </p>
            {projects.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={busy || !item.folders[0]}
                onClick={() =>
                  void mutate(async () => {
                    await development.bindProjectLocation(
                      sessionId,
                      item.id,
                      item.folders[0]!,
                    );
                    setProjectMenuOpen(false);
                  })
                }
                className={cn(
                  "flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[11px] transition-colors hover:bg-muted/70",
                  item.id === project?.id
                    ? "bg-muted/55 text-foreground"
                    : "text-foreground/75",
                )}
              >
                <FolderTree className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {item.folders.length}
                </span>
              </button>
            ))}
            {project ? (
              <div className="mt-1 border-t border-border/35 pt-1">
                <p className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("workspacePane.locations")}
                </p>
                {locations.map((path) => {
                  return (
                    <button
                      key={path}
                      type="button"
                      role="menuitem"
                      disabled={busy}
                      title={path}
                      onClick={() =>
                        void mutate(async () => {
                          await development.bindProjectLocation(
                            sessionId,
                            project.id,
                            path,
                          );
                          setProjectMenuOpen(false);
                        })
                      }
                      className={cn(
                        "flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[11px] transition-colors hover:bg-muted/70",
                        isCurrent(path)
                          ? "bg-muted/55 text-foreground"
                          : "text-foreground/75",
                      )}
                    >
                      <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">
                        {locationLabel(path)}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {chooseDirectory ? (
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => void chooseNewProject()}
                className="mt-1 flex h-8 w-full items-center gap-2 rounded-md border-t border-border/35 px-2.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("workspacePane.newProject")}
              </button>
            ) : null}
          </PopoverContent>
        </Popover>
        {chooseDirectory ? (
          <button
            type="button"
            data-workspace-project-add
            disabled={busy || !project}
            title={t("workspacePane.addFolder")}
            aria-label={t("workspacePane.addFolder")}
            onClick={() => void addFolder()}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/55 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function WorkspaceTreeRows({
  entries,
  sessionId,
  files,
  openFile,
  selectedPath,
  level = 0,
}: {
  entries: WorkspaceTreeEntry[];
  sessionId: string;
  files: WorkspaceFilesAdapter;
  openFile(path: string): void;
  selectedPath?: string;
  level?: number;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [children, setChildren] = useState<
    Record<string, WorkspaceTreeEntry[]>
  >({});

  return (
    <ul>
      {entries.map((entry) => (
        <li key={entry.path}>
          <button
            type="button"
            onClick={() => {
              if (!entry.isDirectory) {
                openFile(entry.path);
                return;
              }
              const next = !expanded[entry.path];
              setExpanded((current) => ({ ...current, [entry.path]: next }));
              if (next && !children[entry.path]) {
                void files
                  .list(sessionId, entry.path)
                  .then((items) =>
                    setChildren((current) => ({
                      ...current,
                      [entry.path]: items,
                    })),
                  )
                  .catch(() => {});
              }
            }}
            className={cn(
              "group flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-[11px] transition-colors",
              selectedPath === entry.path
                ? "bg-muted/65 text-foreground"
                : "text-foreground/78 hover:bg-muted/45 hover:text-foreground",
            )}
            style={{ paddingLeft: `${8 + level * 14}px` }}
          >
            {entry.isDirectory ? (
              expanded[entry.path] ? (
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
              )
            ) : (
              <span className="w-3" />
            )}
            {entry.isDirectory ? (
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground/75" />
            ) : (
              <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground/65" />
            )}
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
          </button>
          {entry.isDirectory && expanded[entry.path] && children[entry.path] ? (
            <WorkspaceTreeRows
              entries={children[entry.path]!}
              sessionId={sessionId}
              files={files}
              openFile={openFile}
              selectedPath={selectedPath}
              level={level + 1}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function WorkspaceFilesBrowser({
  sessionId,
  files,
  development,
  workspaces,
  openFile,
  selectedPath,
}: {
  sessionId: string;
  files: WorkspaceFilesAdapter;
  development?: WorkspaceDevelopmentAdapter;
  workspaces?: WorkspaceAdapter;
  openFile(path: string): void;
  selectedPath?: string;
}) {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<WorkspaceTreeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(
        query.trim()
          ? await files.search(sessionId, query)
          : await files.list(sessionId),
      );
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [files, query, sessionId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), query ? 160 : 0);
    return () => window.clearTimeout(timer);
  }, [load, query]);
  useEffect(
    () =>
      getPlatform().workspaces?.onChange((change) => {
        if (change.sessionId === sessionId) void load();
      }),
    [load, sessionId],
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkspaceProjectStrip
        sessionId={sessionId}
        development={development}
        workspaces={workspaces}
      />
      <div className="relative mx-2.5 my-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("workspacePane.searchFiles")}
          className="h-8 pl-8 text-xs"
        />
      </div>
      <ScrollArea className="min-h-0 flex-1 px-1.5 pb-2">
        {loading ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            {t("common.loading")}
          </p>
        ) : entries.length ? (
          <WorkspaceTreeRows
            entries={entries}
            sessionId={sessionId}
            files={files}
            openFile={openFile}
            selectedPath={selectedPath}
          />
        ) : (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            {t("workspacePane.noFiles")}
          </p>
        )}
      </ScrollArea>
    </div>
  );
}

export function WorkspaceFileWorkspace({
  resource,
  sessionId,
  files,
  development,
  workspaces,
  openFile,
  treeOpen,
  onTreeOpenChange,
  renderPreview,
}: {
  renderPreview(resource: FileResource): ReactNode;
  resource: FileResource | null;
  sessionId: string;
  files: WorkspaceFilesAdapter;
  development?: WorkspaceDevelopmentAdapter;
  workspaces?: WorkspaceAdapter;
  openFile(path: string): void;
  treeOpen: boolean;
  onTreeOpenChange(open: boolean): void;
}) {
  const { t } = useT();
  const path = resource?.path ?? "/";

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/35 px-3">
        <FileCode2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
        <span
          className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-foreground/72"
          title={path}
        >
          {resource ? compactWorkspacePath(resource.path, 7) : "/"}
        </span>
        {resource ? (
          <>
            <PreviewAction
              icon={Copy}
              label={t("workspacePane.copyPath")}
              onSelect={() => void navigator.clipboard.writeText(resource.path)}
            />
            <PreviewMoreMenu
              items={[
                {
                  icon: FolderOpen,
                  label: t("workspacePane.revealFile"),
                  onSelect: () =>
                    void files.reveal(sessionId, resource.path).catch(() => {}),
                },
                {
                  icon: ExternalLink,
                  label: t("workspacePane.openExternal"),
                  onSelect: () =>
                    void files
                      .openExternal(sessionId, resource.path)
                      .catch(() => {}),
                },
              ]}
            />
          </>
        ) : null}
        <button
          type="button"
          aria-pressed={treeOpen}
          aria-label={
            treeOpen
              ? t("workspacePane.hideFileTree")
              : t("workspacePane.showFileTree")
          }
          title={
            treeOpen
              ? t("workspacePane.hideFileTree")
              : t("workspacePane.showFileTree")
          }
          onClick={() => onTreeOpenChange(!treeOpen)}
          className={cn(
            "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
            treeOpen && "bg-muted/55 text-foreground",
          )}
        >
          <FolderTree className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <main
          data-workspace-file-preview
          className="min-h-0 min-w-0 flex-1 overflow-hidden"
        >
          {resource ? (
            renderPreview(resource)
          ) : (
            <div className="flex h-full min-h-0 flex-col items-center justify-center px-8 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted/45 text-muted-foreground/65">
                <FolderOpen className="h-5 w-5" />
              </span>
              <h3 className="mt-3 text-[13px] font-medium text-foreground/85">
                {t("workspacePane.openFile")}
              </h3>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("workspacePane.openFileHint")}
              </p>
            </div>
          )}
        </main>
        {treeOpen ? (
          <aside
            data-workspace-file-tree
            aria-label={t("workspacePane.files")}
            className="min-h-0 min-w-[190px] w-[clamp(190px,36%,260px)] shrink-0 border-l border-border/45 bg-background"
          >
            <WorkspaceFilesBrowser
              sessionId={sessionId}
              files={files}
              development={development}
              workspaces={workspaces}
              openFile={openFile}
              selectedPath={resource?.path}
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function WorkspaceGitReview({
  sessionId,
  files,
  openFile,
  onOpenRecoveryPoints,
}: {
  sessionId: string;
  files?: WorkspaceFilesAdapter;
  openFile(path: string): void;
  onOpenRecoveryPoints(): void;
}) {
  const { t } = useT();
  const development = getPlatform().workspaceDevelopment;
  const [state, setState] = useState<WorkspaceGitState | null>(null);
  const [diff, setDiff] = useState("");
  const [stagedDiff, setStagedDiff] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!development) return;
    try {
      const next = await development.gitStatus(sessionId);
      const [working, staged] = await Promise.all([
        development.gitDiff(sessionId),
        development.gitDiff(sessionId, { staged: true }),
      ]);
      setState(next);
      setDiff(working);
      setStagedDiff(staged);
      setError(null);
      setSelected(
        (current) =>
          new Set(
            [...current].filter((path) =>
              next.files.some((file) => file.path === path),
            ),
          ),
      );
    } catch (cause) {
      setState(null);
      setDiff("");
      setStagedDiff("");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [development, sessionId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const action = async (task: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  if (!development) return <WorkspaceEmptyState />;
  const reviewDiff = [stagedDiff, diff].filter(Boolean).join("\n");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/35 px-3 py-2.5">
        <div className="flex items-center gap-2 text-xs">
          <GitBranch className="h-3.5 w-3.5" />
          <span className="font-medium">
            {state?.branch ?? t("workspacePane.review")}
          </span>
          {state?.upstream ? (
            <span className="truncate text-[10px] text-muted-foreground">
              {state.ahead ? `↑${state.ahead}` : ""}
              {state.behind ? ` ↓${state.behind}` : ""}
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => void refresh()}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50"
              title={t("common.refresh")}
              aria-label={t("common.refresh")}
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
            <CascadeMenu
              align="end"
              ariaLabel={t("workspacePane.moreActions")}
              exclusiveGroup="workspace-review-actions"
              items={[
                {
                  id: "recovery-points",
                  icon: <History />,
                  label: t("workspacePane.recoveryPoints"),
                  onSelect: onOpenRecoveryPoints,
                },
              ]}
              trigger={
                <button
                  type="button"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50"
                  title={t("workspacePane.moreActions")}
                  aria-label={t("workspacePane.moreActions")}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              }
            />
          </div>
        </div>
        {state?.files.length ? (
          <ul className="mt-2 max-h-32 overflow-auto space-y-0.5">
            {state.files.map((file) => (
              <li key={file.path}>
                <label className="flex h-6 items-center gap-2 rounded-md px-1.5 text-[10px] hover:bg-muted/40">
                  <input
                    type="checkbox"
                    checked={selected.has(file.path)}
                    onChange={(event) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(file.path);
                        else next.delete(file.path);
                        return next;
                      })
                    }
                  />
                  <span className="w-6 font-mono text-muted-foreground">
                    {file.indexStatus}
                    {file.worktreeStatus}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono">
                    {file.path}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {state?.clean ? t("workspacePane.clean") : error}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            disabled={busy || !state?.files.some((file) => !file.staged)}
            onClick={() =>
              void action(() =>
                development.gitStage(
                  sessionId,
                  selected.size ? [...selected] : undefined,
                ),
              )
            }
          >
            {t("workspacePane.stage")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            disabled={busy || !state?.files.some((file) => file.staged)}
            onClick={() =>
              void action(() =>
                development.gitUnstage(
                  sessionId,
                  selected.size ? [...selected] : undefined,
                ),
              )
            }
          >
            {t("workspacePane.unstage")}
          </Button>
          <Input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={t("workspacePane.commitMessage")}
            className="h-7 min-w-36 flex-1 text-[11px]"
          />
          <Button
            size="sm"
            className="h-7 text-[11px]"
            disabled={
              busy ||
              !message.trim() ||
              !state?.files.some((file) => file.staged)
            }
            onClick={() =>
              void action(async () => {
                await development.gitCommit(sessionId, message);
                setMessage("");
              })
            }
          >
            <GitCommitHorizontal className="h-3 w-3" />
            {t("workspacePane.commit")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            disabled={busy || !state || !state.clean}
            onClick={() => void action(() => development.gitShip(sessionId))}
          >
            <Send className="h-3 w-3" />
            {t("workspacePane.ship")}
          </Button>
        </div>
        {error ? (
          <p className="mt-2 text-[10px] leading-4 text-destructive">{error}</p>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">
        {reviewDiff ? (
          <DiffView
            resource={{
              kind: "diff",
              reviewId: `git:${sessionId}`,
              scope: "turn",
              entries: [
                {
                  toolCallId: `git:${sessionId}`,
                  diff: reviewDiff,
                  paths: state?.files.map((file) => file.path) ?? [],
                },
              ],
            }}
            onOpenFile={openFile}
            sessionId={sessionId}
            files={files}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {t("workspacePane.noWorkingChanges")}
          </div>
        )}
      </div>
    </div>
  );
}

type PendingTerminalChunk = {
  sequence: number;
  chunk: string;
};

export function WorkspaceTerminalView({
  sessionId,
  terminalId,
  development,
  onSnapshot,
}: {
  sessionId: string;
  terminalId: string;
  development: WorkspaceDevelopmentAdapter;
  onSnapshot: (snapshot: WorkspaceTerminalSnapshot) => void;
}) {
  const { t } = useT();
  const documentTheme = useDocumentTheme();
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XtermTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initialThemeRef = useRef(documentTheme);
  const hydratedRef = useRef(false);
  const outputSequenceRef = useRef(0);
  const pendingChunksRef = useRef<PendingTerminalChunk[]>([]);
  const [error, setError] = useState<string | null>(null);

  const hydrateTerminal = useCallback(
    (next: WorkspaceTerminalSnapshot) => {
      const terminal = terminalRef.current;
      if (!terminal) return;
      terminal.reset();
      terminal.write(next.output);
      outputSequenceRef.current = next.sequence;
      hydratedRef.current = true;
      for (const event of pendingChunksRef.current) {
        if (event.sequence <= outputSequenceRef.current) continue;
        terminal.write(event.chunk);
        outputSequenceRef.current = event.sequence;
      }
      pendingChunksRef.current = [];
      onSnapshot(next);
    },
    [onSnapshot],
  );

  useEffect(() => {
    if (!development || !hostRef.current) return;
    let disposed = false;
    let resizeFrame: number | null = null;
    hydratedRef.current = false;
    outputSequenceRef.current = 0;
    pendingChunksRef.current = [];

    const terminal = new XtermTerminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.35,
      macOptionIsMeta: true,
      minimumContrastRatio: 4.5,
      scrollOnUserInput: true,
      scrollback: 10_000,
      theme: workspaceTerminalTheme(initialThemeRef.current),
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(hostRef.current);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    terminal.attachCustomKeyEventHandler((event) => {
      if (
        event.type === "keydown" &&
        event.metaKey &&
        event.key.toLocaleLowerCase() === "c" &&
        terminal.hasSelection()
      ) {
        void navigator.clipboard.writeText(terminal.getSelection());
        return false;
      }
      return true;
    });

    const inputSubscription = terminal.onData((data) => {
      development.terminalWrite(sessionId, terminalId, data);
    });
    const resizeSubscription = terminal.onResize(({ cols, rows }) => {
      development.terminalResize(sessionId, terminalId, cols, rows);
    });
    const unsubscribe = development.onTerminalData((event) => {
      if (
        event.sessionId !== sessionId ||
        event.terminalId !== terminalId ||
        disposed
      )
        return;
      if (!hydratedRef.current) {
        pendingChunksRef.current.push({
          sequence: event.sequence,
          chunk: event.chunk,
        });
        return;
      }
      if (event.sequence <= outputSequenceRef.current) return;
      terminal.write(event.chunk);
      outputSequenceRef.current = event.sequence;
    });

    const fit = () => {
      if (disposed || !hostRef.current) return;
      try {
        fitAddon.fit();
        development.terminalResize(
          sessionId,
          terminalId,
          terminal.cols,
          terminal.rows,
        );
      } catch {
        /* The pane can collapse between ResizeObserver and animation frame. */
      }
    };
    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrame != null) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(fit);
    });
    resizeObserver.observe(hostRef.current);
    fit();

    void development
      .terminalGet(sessionId, terminalId)
      .then(
        (current) =>
          current ?? development.terminalStart(sessionId, terminalId),
      )
      .then((next) => {
        if (disposed) return;
        hydrateTerminal(next);
        fit();
        terminal.focus();
        setError(null);
      })
      .catch((cause) => {
        if (!disposed)
          setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      disposed = true;
      if (resizeFrame != null) cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      unsubscribe();
      inputSubscription.dispose();
      resizeSubscription.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [development, hydrateTerminal, sessionId, terminalId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.theme = workspaceTerminalTheme(documentTheme);
    fitAddonRef.current?.fit();
  }, [documentTheme]);

  return (
    <div
      data-workspace-terminal-id={terminalId}
      className="relative h-full min-h-0 bg-background p-2"
    >
      <div
        ref={hostRef}
        data-selection="text"
        className="amiba-terminal h-full min-h-0 overflow-hidden"
        aria-label={t("workspacePane.terminal")}
      />
      {error ? (
        <p className="pointer-events-none absolute inset-x-3 bottom-3 rounded-md border border-destructive/20 bg-background/95 px-2 py-1.5 text-[10px] text-destructive shadow-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function createWorkspaceTerminalId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `terminal-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export function WorkspaceTerminalToggle({
  open,
  onToggle,
  className,
  showUnavailable = false,
}: {
  open: boolean;
  onToggle: () => void;
  className?: string;
  showUnavailable?: boolean;
}) {
  const pane = useWorkspacePane();
  const { t } = useT();
  const available = pane.enabled && !!pane.sessionId && !!pane.development;
  if (!available && !showUnavailable) return null;
  return (
    <button
      type="button"
      disabled={!available}
      onClick={() => {
        if (available) onToggle();
      }}
      title={
        open
          ? t("workspacePane.closeTerminal")
          : t("workspacePane.openTerminal")
      }
      aria-label={
        open
          ? t("workspacePane.closeTerminal")
          : t("workspacePane.openTerminal")
      }
      aria-pressed={open}
      className={cn(
        "app-no-drag relative inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors",
        "hover:bg-foreground/5 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        "disabled:pointer-events-none disabled:opacity-30",
        open && "bg-foreground/5 text-foreground",
        className,
      )}
    >
      <PanelBottom className="h-3.5 w-3.5" />
    </button>
  );
}

export function WorkspaceTerminalPanel({
  visible = true,
  open,
  onClose,
}: {
  visible?: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const pane = useWorkspacePane();
  const { t } = useT();
  const development = pane.development;
  const [height, setHeight] = useState(() =>
    clampTerminalHeight(DEFAULT_TERMINAL_HEIGHT),
  );
  const [terminals, setTerminals] = useState<WorkspaceTerminalSnapshot[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const heightRef = useRef(height);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  heightRef.current = height;

  useEffect(
    () => () => {
      resizeCleanupRef.current?.();
    },
    [],
  );

  useEffect(() => {
    const onWindowResize = () => {
      setHeight((current) => {
        const next = clampTerminalHeight(current);
        heightRef.current = next;
        return next;
      });
    };
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getPlatform()
      .storage.get(TERMINAL_HEIGHT_KEY)
      .then((result) => {
        if (cancelled) return;
        const stored = result[TERMINAL_HEIGHT_KEY];
        if (typeof stored === "number" && Number.isFinite(stored)) {
          setHeight(clampTerminalHeight(stored));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setTerminals([]);
    setActiveTerminalId(null);
    setTerminalError(null);
  }, [pane.sessionId]);

  useEffect(() => {
    if (!visible || !open || !pane.enabled || !development) return;
    let cancelled = false;
    const sessionId = pane.sessionId;
    setTerminalBusy(true);
    void development
      .terminalList(sessionId)
      .then(async (existing) => {
        const next = existing.length
          ? existing
          : [await development.terminalStart(sessionId, "primary")];
        if (cancelled) return;
        setTerminals(next);
        setActiveTerminalId((current) =>
          current && next.some((terminal) => terminal.terminalId === current)
            ? current
            : (next[0]?.terminalId ?? null),
        );
        setTerminalError(null);
      })
      .catch((cause) => {
        if (!cancelled)
          setTerminalError(
            cause instanceof Error ? cause.message : String(cause),
          );
      })
      .finally(() => {
        if (!cancelled) setTerminalBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [development, open, pane.enabled, pane.sessionId, visible]);

  const updateTerminalSnapshot = useCallback(
    (snapshot: WorkspaceTerminalSnapshot) => {
      setTerminals((current) => {
        const index = current.findIndex(
          (terminal) => terminal.terminalId === snapshot.terminalId,
        );
        if (index < 0) return [...current, snapshot];
        const next = [...current];
        next[index] = snapshot;
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    if (!visible || !open || !development) return;
    return development.onTerminalData((event) => {
      if (event.sessionId === pane.sessionId) {
        updateTerminalSnapshot(event.snapshot);
      }
    });
  }, [development, open, pane.sessionId, updateTerminalSnapshot, visible]);

  const addTerminal = useCallback(async () => {
    if (!development || terminalBusy) return;
    setTerminalBusy(true);
    try {
      const snapshot = await development.terminalStart(
        pane.sessionId,
        createWorkspaceTerminalId(),
      );
      setTerminals((current) => [...current, snapshot]);
      setActiveTerminalId(snapshot.terminalId);
      setTerminalError(null);
    } catch (cause) {
      setTerminalError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setTerminalBusy(false);
    }
  }, [development, pane.sessionId, terminalBusy]);

  const closeTerminal = useCallback(
    async (terminalId: string) => {
      if (!development) return;
      const closingIndex = terminals.findIndex(
        (terminal) => terminal.terminalId === terminalId,
      );
      try {
        await development.terminalStop(pane.sessionId, terminalId);
        const remaining = terminals.filter(
          (terminal) => terminal.terminalId !== terminalId,
        );
        setTerminals(remaining);
        if (activeTerminalId === terminalId) {
          setActiveTerminalId(
            remaining[Math.min(Math.max(closingIndex, 0), remaining.length - 1)]
              ?.terminalId ?? null,
          );
        }
        setTerminalError(null);
        if (remaining.length === 0) onClose();
      } catch (cause) {
        setTerminalError(
          cause instanceof Error ? cause.message : String(cause),
        );
      }
    },
    [activeTerminalId, development, onClose, pane.sessionId, terminals],
  );

  const onResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      resizeCleanupRef.current?.();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      const startY = event.clientY;
      const startHeight = heightRef.current;
      const previousCursor = document.documentElement.style.cursor;
      const previousUserSelect = document.documentElement.style.userSelect;
      let nextHeight = startHeight;
      document.documentElement.style.cursor = "row-resize";
      document.documentElement.style.userSelect = "none";
      let finished = false;

      const onMove = (moveEvent: PointerEvent) => {
        moveEvent.preventDefault();
        nextHeight = clampTerminalHeight(
          startHeight - (moveEvent.clientY - startY),
        );
        heightRef.current = nextHeight;
        setHeight(nextHeight);
      };
      const finish = () => {
        if (finished) return;
        finished = true;
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", finish);
        handle.removeEventListener("pointercancel", finish);
        document.documentElement.style.cursor = previousCursor;
        document.documentElement.style.userSelect = previousUserSelect;
        if (resizeCleanupRef.current === finish) {
          resizeCleanupRef.current = null;
        }
        void getPlatform().storage.set({
          [TERMINAL_HEIGHT_KEY]: nextHeight,
        });
      };
      resizeCleanupRef.current = finish;
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", finish);
      handle.addEventListener("pointercancel", finish);
    },
    [],
  );

  if (!visible || !pane.enabled || !development) return null;
  const activeTerminal = terminals.find(
    (terminal) => terminal.terminalId === activeTerminalId,
  );
  return (
    <div
      data-workspace-terminal-panel
      aria-hidden={!open}
      className={cn(
        "relative shrink-0 overflow-hidden border-t border-border/50 bg-background transition-[height] duration-200 ease-out motion-reduce:transition-none",
        !open && "pointer-events-none border-transparent",
      )}
      style={{ height: open ? height : 0 }}
    >
      {open ? (
        <>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label={t("workspacePane.resizeTerminal")}
            onPointerDown={onResizeStart}
            className="group absolute inset-x-0 top-0 z-40 h-1 -translate-y-1/2 cursor-row-resize touch-none"
          >
            <div className="absolute inset-x-0 top-1/2 h-px bg-border/55 transition-colors group-hover:bg-foreground/15 group-active:bg-foreground/25" />
          </div>
          <div className="flex h-full min-h-0 flex-col">
            <div
              data-workspace-terminal-tabs-bar
              className="flex h-10 shrink-0 items-center px-3"
            >
              <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <div
                  role="tablist"
                  aria-label={t("workspacePane.terminalTabs")}
                  className="flex w-max min-w-full items-center gap-1"
                >
                  {terminals.map((terminal, index) => {
                    const active = terminal.terminalId === activeTerminalId;
                    const label = terminal.title || `Terminal ${index + 1}`;
                    return (
                      <div
                        key={terminal.terminalId}
                        data-workspace-terminal-tab={terminal.terminalId}
                        className={cn(
                          "group flex h-7 max-w-52 shrink-0 items-center rounded-md text-xs transition-colors",
                          active
                            ? "bg-muted/75 text-foreground"
                            : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                        )}
                      >
                        <button
                          type="button"
                          role="tab"
                          aria-selected={active}
                          onClick={() =>
                            setActiveTerminalId(terminal.terminalId)
                          }
                          className="flex min-w-0 items-center gap-2 py-1 pl-2 pr-1"
                        >
                          <Terminal className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate font-medium">{label}</span>
                          {!terminal.running ? (
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/45"
                              title={t("workspacePane.terminalStopped")}
                            />
                          ) : null}
                        </button>
                        <button
                          type="button"
                          aria-label={t("workspacePane.closeTerminalTab", {
                            title: label,
                          })}
                          title={t("workspacePane.closeTerminalTab", {
                            title: label,
                          })}
                          onClick={() =>
                            void closeTerminal(terminal.terminalId)
                          }
                          className="mr-1 rounded p-1 text-muted-foreground/70 transition-colors hover:bg-foreground/[0.07] hover:text-foreground"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    disabled={terminalBusy}
                    aria-label={t("workspacePane.newTerminal")}
                    title={t("workspacePane.newTerminal")}
                    onClick={() => void addTerminal()}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-40"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <button
                type="button"
                aria-label={t("workspacePane.hideTerminalPanel")}
                title={t("workspacePane.hideTerminalPanel")}
                onClick={onClose}
                className="ml-2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="relative min-h-0 flex-1">
              {activeTerminal ? (
                <WorkspaceTerminalView
                  key={`${pane.sessionId}:${activeTerminal.terminalId}`}
                  sessionId={pane.sessionId}
                  terminalId={activeTerminal.terminalId}
                  development={development}
                  onSnapshot={updateTerminalSnapshot}
                />
              ) : terminalBusy ? (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  {t("workspacePane.startingTerminal")}
                </div>
              ) : null}
              {terminalError ? (
                <p className="pointer-events-none absolute inset-x-3 bottom-3 rounded-md border border-destructive/20 bg-background/95 px-2 py-1.5 text-[10px] text-destructive shadow-sm">
                  {terminalError}
                </p>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function WorkspaceRecoveryPointsView() {
  const { t } = useT();
  const pane = useWorkspacePane();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const items = pane.checkpoints.filter(
    (item) => item.kind !== "turn-start" || item.hasChanges,
  );
  useEffect(() => {
    void pane.refreshCheckpoints().catch(() => {});
  }, [pane.refreshCheckpoints]);
  if (!pane.development) return <WorkspaceEmptyState />;
  return (
    <ScrollArea className="h-full">
      <div className="p-3">
        <div className="px-2 pb-2">
          <h3 className="text-xs font-medium">
            {t("workspacePane.recoveryPoints")}
          </h3>
          <p className="mt-1 text-[10.5px] leading-4 text-muted-foreground">
            {t("workspacePane.recoveryPointsHint")}
          </p>
        </div>
        {error ? (
          <p className="mx-2 mt-2 text-xs text-destructive">{error}</p>
        ) : null}
        <ul className="mt-1 space-y-1">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/35"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">
                  {item.kind === "turn-start" && item.turnIndex !== undefined
                    ? t("workspacePane.recoveryTask", {
                        count: item.turnIndex + 1,
                      })
                    : item.kind === "restore-safety"
                      ? t("workspacePane.recoverySafety")
                      : item.label}
                </span>
                <span className="mt-0.5 block text-[10px] text-muted-foreground">
                  {new Date(item.createdAt).toLocaleString()} ·{" "}
                  {t("workspacePane.snapshotFiles", {
                    count: item.changedFiles,
                  })}
                  {item.complete === false
                    ? ` · ${t("workspacePane.recoveryIncomplete")}`
                    : ""}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={busyId !== null || item.complete === false}
                className="h-7 text-[11px]"
                onClick={() =>
                  void (async () => {
                    if (
                      !window.confirm(
                        t("sidepanel.message.restoreWorkspaceConfirm"),
                      )
                    )
                      return;
                    setBusyId(item.id);
                    try {
                      await pane.restoreCheckpoint(item.id);
                      setError(null);
                    } catch (cause) {
                      setError(
                        cause instanceof Error ? cause.message : String(cause),
                      );
                    } finally {
                      setBusyId(null);
                    }
                  })()
                }
              >
                <Undo2 className="h-3 w-3" />
                {t("workspacePane.restore")}
              </Button>
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => {
                  if (!window.confirm(t("workspacePane.deleteRecoveryConfirm")))
                    return;
                  setBusyId(item.id);
                  void pane
                    .deleteCheckpoint(item.id)
                    .then(() => setError(null))
                    .catch((cause) =>
                      setError(
                        cause instanceof Error ? cause.message : String(cause),
                      ),
                    )
                    .finally(() => setBusyId(null));
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/8 hover:text-destructive disabled:opacity-40"
                title={t("workspacePane.deleteRecovery")}
                aria-label={t("workspacePane.deleteRecovery")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
        {!items.length ? (
          <p className="py-12 text-center text-xs text-muted-foreground">
            {t("workspacePane.noCheckpoints")}
          </p>
        ) : null}
      </div>
    </ScrollArea>
  );
}

export function WorkspacePane({
  visible = true,
  renderPanel,
  inspectToolCall = () => false,
}: {
  visible?: boolean;
  renderPanel?: (owner: WorkbenchPanelOwner) => React.ReactNode;
  inspectToolCall?: (callId: string) => boolean;
}) {
  const pane = useWorkspacePane();
  const extensions = useWorkbenchExtensions();
  const launchers = extensions.filter(
    (entry) =>
      entry.launcher &&
      selectWorkbenchView(extensions, entry.resourceType) === entry,
  );
  const { t } = useT();
  // The view mode and the file-tree fold are part of the session's workbench
  // record (see `SessionPaneState`), so leaving a task and coming back finds
  // it exactly as it was left. The tree starts closed: the pane usually opens
  // to show a PREVIEW (a browser tab, a diff, a file the agent touched), and a
  // directory tree unfolding beside it on every open reads as clutter.
  const { mode, setMode, fileTreeOpen, setFileTreeOpen } = pane;
  const openPanel = useCallback(
    (id: string) => {
      pane.setMode(`extension:${id}`);
      pane.setOpen(true);
    },
    [pane.setMode, pane.setOpen],
  );
  const panelOwner = {
    openResource: pane.openResource,
    activePanel: mode.startsWith("extension:") ? mode.slice(10) : null,
    openPanel,
    inspectToolCall,
    renderMarkdown: (text: string) => <ChatMarkdown>{text}</ChatMarkdown>,
  };
  const active = pane.activeTab;
  const widthRef = useRef(pane.width);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const tabRailRef = useHorizontalWheelScroll<HTMLDivElement>();
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  widthRef.current = pane.width;

  useEffect(
    () => () => {
      resizeCleanupRef.current?.();
    },
    [],
  );

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
        <div className="absolute inset-y-0 left-1/2 w-px bg-border/60 transition-colors group-hover:bg-foreground/12 group-active:bg-foreground/20" />
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
          className="flex h-11 shrink-0 items-center bg-background pl-2"
          // The edge-control row floats over this strip at z-50 and its width
          // is not fixed (it also hosts an open plugin seat), so it publishes
          // its measured width and the tabs reserve exactly that.
          style={{
            paddingRight: "var(--amiba-workbench-controls-inset, 2.75rem)",
          }}
        >
          {pane.sessionId || pane.tabs.length > 0 ? (
            <div
              ref={tabRailRef}
              role="tablist"
              aria-label={t("workspacePane.tabs")}
              // `self-stretch` is what separates the hairline from the pills,
              // and it needs no padding to do it: the rail fills the 44px
              // strip, the scrollbar takes 3px off the bottom of the padding
              // box, and `items-center` then centres the 28px pills in the
              // remaining 41px — which leaves 6.5px of clearance above the
              // hairline for free. Adding padding instead would push the pills
              // off the strip's optical centre, since the gap would be counted
              // as content to centre around.
              className="amiba-tab-rail flex min-w-0 flex-1 self-stretch items-center gap-1.5 overflow-x-auto"
            >
              {renderPanel?.({ ...panelOwner, placement: "tab" })}
              {launchers.map((entry) => {
                const id = `view:${entry.resourceType}` as const;
                const selected = mode === id || mode === entry.resourceType;
                const Icon = entry.launcher!.icon;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setMode(id)}
                    className={cn(
                      "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[10.5px] transition-colors",
                      selected
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    {Icon && <Icon className="h-3.5 w-3.5" />}
                    {entry.launcher!.label()}
                  </button>
                );
              })}
              {pane.tabs.map((tab) => {
                const selected = mode === "preview" && tab.id === active?.id;
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
                      setMode("preview");
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

        <div className="relative min-h-0 flex-1">
          <div className="h-full min-h-0">
            {mode.startsWith("extension:") ? (
              renderPanel?.({ ...panelOwner, placement: "content" })
            ) : (
              <WorkbenchResourceView
                resource={
                  mode.startsWith("view:")
                    ? { type: mode.slice(5), id: mode.slice(5), title: "" }
                    : mode === "checkpoints"
                      ? {
                          type: "checkpoints",
                          id: "checkpoints",
                          title: t("workspacePane.recoveryPoints"),
                        }
                      : mode === "files" || !active
                        ? {
                            type: "files",
                            id: "files",
                            title: t("workspacePane.files"),
                          }
                        : toWorkbenchResource(active.resource)
                }
                sessionId={pane.sessionId}
                openResource={pane.openResource}
                openFile={pane.openFile}
              />
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

/** Adapt legacy tool/browser events at the host boundary; views use the open protocol. */
export function toWorkbenchResource(
  resource: WorkspacePaneResource,
): WorkbenchResource {
  if (resource.kind === "extension") return resource.resource;
  return {
    type: resource.kind,
    id: resourceKey(resource),
    title: resourceTitle(resource),
    data: resource,
  };
}
function BuiltinCodeView({ resource }: WorkbenchViewProps) {
  return (
    <CodeExecutionView resource={resource.data as CodeExecutionResource} />
  );
}
function BuiltinDiffView({
  resource,
  sessionId,
  openFile,
}: WorkbenchViewProps) {
  const pane = useWorkspacePane();
  return (
    <DiffView
      resource={resource.data as DiffResource}
      onOpenFile={openFile}
      sessionId={sessionId}
      files={pane.files}
    />
  );
}
/** Built-ins participate in the same contribution ledger as third-party views. */
export const builtinWorkbenchViews: readonly WorkbenchViewExtension[] = [
  {
    id: "amiba.code",
    resourceType: "code",
    order: 100,
    component: BuiltinCodeView,
  },
  {
    id: "amiba.diff",
    resourceType: "diff",
    order: 100,
    component: BuiltinDiffView,
  },
  {
    id: "amiba.checkpoints",
    resourceType: "checkpoints",
    order: 100,
    component: WorkspaceRecoveryPointsView,
  },
];
