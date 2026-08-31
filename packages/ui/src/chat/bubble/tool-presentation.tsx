import type { ToolProgress } from "@amiba/app-runtime/core";
import type { TranslateFn } from "@amiba/i18n";
import {
  BookOpen,
  Braces,
  ChevronRight,
  Code2,
  ExternalLink,
  Eye,
  FileCode2,
  FilePenLine,
  FileText,
  FolderSearch,
  Globe,
  Image,
  Keyboard,
  ListTodo,
  type LucideIcon,
  MemoryStick,
  MessageCircleQuestion,
  MousePointer2,
  Search,
  Terminal,
  Users,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../primitives";
import { useWorkspacePane } from "../WorkspacePane";

type ToolKind =
  | "web-search"
  | "web"
  | "browser"
  | "browser-input"
  | "read-file"
  | "write-file"
  | "search-files"
  | "terminal"
  | "background-job"
  | "code"
  | "delegation"
  | "tasks"
  | "skill"
  | "memory"
  | "generate-media"
  | "inspect-media"
  | "ask-user"
  | "generic";

interface ToolSpec {
  kind: ToolKind;
  actionKey: Parameters<TranslateFn>[0];
  icon: LucideIcon;
}

const TOOL_SPECS: Record<string, ToolSpec> = {
  web_search: {
    kind: "web-search",
    actionKey: "sidepanel.trace.actions.searchWeb",
    icon: Search,
  },
  x_search: {
    kind: "web-search",
    actionKey: "sidepanel.trace.actions.searchWeb",
    icon: Search,
  },
  web_extract: {
    kind: "web",
    actionKey: "sidepanel.trace.actions.readWeb",
    icon: Globe,
  },
  browser_navigate: {
    kind: "browser",
    actionKey: "sidepanel.trace.actions.browse",
    icon: Globe,
  },
  browser_back: {
    kind: "browser",
    actionKey: "sidepanel.trace.actions.browse",
    icon: Globe,
  },
  browser_snapshot: {
    kind: "browser",
    actionKey: "sidepanel.trace.actions.inspectPage",
    icon: Eye,
  },
  browser_vision: {
    kind: "browser",
    actionKey: "sidepanel.trace.actions.inspectPage",
    icon: Eye,
  },
  browser_console: {
    kind: "browser",
    actionKey: "sidepanel.trace.actions.inspectPage",
    icon: Braces,
  },
  browser_get_images: {
    kind: "browser",
    actionKey: "sidepanel.trace.actions.inspectPage",
    icon: Image,
  },
  browser_click: {
    kind: "browser-input",
    actionKey: "sidepanel.trace.actions.click",
    icon: MousePointer2,
  },
  browser_type: {
    kind: "browser-input",
    actionKey: "sidepanel.trace.actions.type",
    icon: Keyboard,
  },
  browser_press: {
    kind: "browser-input",
    actionKey: "sidepanel.trace.actions.type",
    icon: Keyboard,
  },
  browser_scroll: {
    kind: "browser-input",
    actionKey: "sidepanel.trace.actions.browse",
    icon: MousePointer2,
  },
  browser_dialog: {
    kind: "browser-input",
    actionKey: "sidepanel.trace.actions.click",
    icon: MousePointer2,
  },
  read_file: {
    kind: "read-file",
    actionKey: "sidepanel.trace.actions.readFile",
    icon: FileText,
  },
  write_file: {
    kind: "write-file",
    actionKey: "sidepanel.trace.actions.writeFile",
    icon: FilePenLine,
  },
  patch: {
    kind: "write-file",
    actionKey: "sidepanel.trace.actions.editFile",
    icon: FilePenLine,
  },
  search_files: {
    kind: "search-files",
    actionKey: "sidepanel.trace.actions.searchFiles",
    icon: FolderSearch,
  },
  terminal: {
    kind: "terminal",
    actionKey: "sidepanel.trace.actions.runCommand",
    icon: Terminal,
  },
  bash: {
    kind: "terminal",
    actionKey: "sidepanel.trace.actions.runCommand",
    icon: Terminal,
  },
  job_output: {
    // Background-job ids (bash-1, …) are runtime internals — the row shows
    // the semantic action only, never the id.
    kind: "background-job",
    actionKey: "sidepanel.trace.actions.readJobOutput",
    icon: Terminal,
  },
  process: {
    kind: "terminal",
    actionKey: "sidepanel.trace.actions.runCommand",
    icon: Terminal,
  },
  read_terminal: {
    kind: "terminal",
    actionKey: "sidepanel.trace.actions.runCommand",
    icon: Terminal,
  },
  close_terminal: {
    kind: "terminal",
    actionKey: "sidepanel.trace.actions.runCommand",
    icon: Terminal,
  },
  execute_code: {
    kind: "code",
    actionKey: "sidepanel.trace.actions.runCode",
    icon: Code2,
  },
  delegate_task: {
    kind: "delegation",
    actionKey: "sidepanel.trace.actions.delegate",
    icon: Users,
  },
  todo: {
    kind: "tasks",
    actionKey: "sidepanel.trace.actions.updateTasks",
    icon: ListTodo,
  },
  skill_view: {
    kind: "skill",
    actionKey: "sidepanel.trace.actions.useSkill",
    icon: BookOpen,
  },
  skills_list: {
    kind: "skill",
    actionKey: "sidepanel.trace.actions.useSkill",
    icon: BookOpen,
  },
  skill_manage: {
    kind: "skill",
    actionKey: "sidepanel.trace.actions.useSkill",
    icon: BookOpen,
  },
  memory: {
    kind: "memory",
    actionKey: "sidepanel.trace.actions.updateMemory",
    icon: MemoryStick,
  },
  image_generate: {
    kind: "generate-media",
    actionKey: "sidepanel.trace.actions.generateMedia",
    icon: Image,
  },
  video_generate: {
    kind: "generate-media",
    actionKey: "sidepanel.trace.actions.generateMedia",
    icon: Image,
  },
  text_to_speech: {
    kind: "generate-media",
    actionKey: "sidepanel.trace.actions.generateMedia",
    icon: Image,
  },
  vision_analyze: {
    kind: "inspect-media",
    actionKey: "sidepanel.trace.actions.inspectMedia",
    icon: Eye,
  },
  video_analyze: {
    kind: "inspect-media",
    actionKey: "sidepanel.trace.actions.inspectMedia",
    icon: Eye,
  },
  browser_cdp: {
    kind: "browser",
    actionKey: "sidepanel.trace.actions.inspectPage",
    icon: Braces,
  },
  open_preview: {
    kind: "browser",
    actionKey: "sidepanel.trace.actions.browse",
    icon: Globe,
  },
  focus_pane: {
    kind: "browser-input",
    actionKey: "sidepanel.trace.actions.click",
    icon: MousePointer2,
  },
  session_search: {
    kind: "web-search",
    actionKey: "sidepanel.trace.actions.searchSessions",
    icon: Search,
  },
  clarify: {
    kind: "generic",
    actionKey: "sidepanel.trace.actions.askUser",
    icon: MousePointer2,
  },
  // The official dsh-tool-ask-user interaction: the live Q&A happens in the
  // composer dock sheet; this row is the timeline's audit record of it.
  ask_user_question: {
    kind: "ask-user",
    actionKey: "sidepanel.trace.actions.askUser",
    icon: MessageCircleQuestion,
  },
  project_create: {
    kind: "generic",
    actionKey: "sidepanel.trace.actions.manageProject",
    icon: FolderSearch,
  },
  project_list: {
    kind: "generic",
    actionKey: "sidepanel.trace.actions.manageProject",
    icon: FolderSearch,
  },
  project_switch: {
    kind: "generic",
    actionKey: "sidepanel.trace.actions.manageProject",
    icon: FolderSearch,
  },
  send_message: {
    kind: "generic",
    actionKey: "sidepanel.trace.actions.sendMessage",
    icon: MousePointer2,
  },
  ha_call_service: {
    kind: "generic",
    actionKey: "sidepanel.trace.actions.controlDevice",
    icon: Wrench,
  },
  ha_get_state: {
    kind: "generic",
    actionKey: "sidepanel.trace.actions.controlDevice",
    icon: Wrench,
  },
  ha_list_entities: {
    kind: "generic",
    actionKey: "sidepanel.trace.actions.controlDevice",
    icon: Wrench,
  },
  ha_list_services: {
    kind: "generic",
    actionKey: "sidepanel.trace.actions.controlDevice",
    icon: Wrench,
  },
};

for (const tool of [
  "spotify_albums",
  "spotify_devices",
  "spotify_library",
  "spotify_playback",
  "spotify_playlists",
  "spotify_queue",
  "spotify_search",
]) {
  TOOL_SPECS[tool] = {
    kind: "generic",
    actionKey: "sidepanel.trace.actions.controlMedia",
    icon: Image,
  };
}

const GENERIC_SPEC: ToolSpec = {
  kind: "generic",
  actionKey: "sidepanel.trace.actions.useTool",
  icon: Wrench,
};

const QUIET_SUCCESS_TOOLS = new Set([
  "clarify",
  "focus_pane",
  "project_create",
  "project_switch",
  "send_message",
  "ha_call_service",
]);

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parsedArgs(event: ToolProgress): Record<string, unknown> {
  if (event.args) return event.args;
  const label = (event.label ?? "").trim();
  if (!label.startsWith("{")) return {};
  try {
    return recordOf(JSON.parse(label)) ?? {};
  } catch {
    return {};
  }
}

function stringValue(
  record: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function firstListString(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const first = value.find((item) => typeof item === "string");
  return typeof first === "string" ? first : "";
}

function oneline(value: string, max = 120): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function compactPath(path: string, maxLength = 34): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\/+/, "");
  if (normalized.length <= maxLength) return normalized;
  const tail = normalized.slice(-(maxLength - 2)).replace(/^\/+/, "");
  return `…/${tail}`;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

function lineRange(args: Record<string, unknown>): string {
  const offset = typeof args.offset === "number" ? args.offset : null;
  const limit = typeof args.limit === "number" ? args.limit : null;
  if (offset == null) return "";
  return limit && limit > 1 ? `L${offset}–${offset + limit - 1}` : `L${offset}`;
}

function fallbackTarget(event: ToolProgress): string {
  const label = (event.label ?? "").trim();
  if (!label || label === event.tool || label.startsWith("{")) return "";
  return oneline(label);
}

function targetFor(event: ToolProgress, spec: ToolSpec): string {
  const args = parsedArgs(event);
  switch (spec.kind) {
    case "web-search":
      return oneline(stringValue(args, "query", "q") || fallbackTarget(event));
    case "web": {
      const url =
        stringValue(args, "url", "href") ||
        firstListString(args.urls) ||
        fallbackTarget(event);
      return hostname(url);
    }
    case "browser": {
      const url = stringValue(args, "url", "href") || fallbackTarget(event);
      return url ? hostname(url) : "";
    }
    case "browser-input":
      return oneline(
        stringValue(args, "ref", "selector", "key", "text") ||
          fallbackTarget(event),
        80,
      );
    case "read-file":
    case "write-file": {
      const path = stringValue(args, "path", "file", "filepath");
      const lines = lineRange(args);
      return [path ? compactPath(path) : fallbackTarget(event), lines]
        .filter(Boolean)
        .join(" · ");
    }
    case "search-files":
      return oneline(
        stringValue(args, "pattern", "query", "path") || fallbackTarget(event),
      );
    case "terminal":
      return oneline(
        stringValue(args, "command", "data", "action") || fallbackTarget(event),
      );
    case "background-job":
      // Never surface internal job ids or their English view titles.
      return "";
    case "code":
      return (
        stringValue(args, "language", "lang", "runtime") ||
        fallbackTarget(event)
      );
    case "delegation":
      return oneline(stringValue(args, "goal") || fallbackTarget(event));
    case "tasks": {
      const todos = Array.isArray(args.todos) ? args.todos : [];
      return todos.length
        ? String(todos.length)
        : oneline(
            stringValue(args, "action", "title", "task_id") ||
              fallbackTarget(event),
          );
    }
    case "skill":
      return oneline(
        stringValue(args, "name", "category") || fallbackTarget(event),
      );
    case "memory":
      return oneline(
        [stringValue(args, "action"), stringValue(args, "target")]
          .filter(Boolean)
          .join(" · ") || fallbackTarget(event),
      );
    case "generate-media":
    case "inspect-media":
      return oneline(
        stringValue(args, "prompt", "question", "text") ||
          fallbackTarget(event),
      );
    default: {
      // Note: internal correlation ids (job_id, …) are deliberately NOT
      // semantic targets — they are runtime bookkeeping, not user language.
      const semanticTarget = stringValue(
        args,
        "name",
        "query",
        "target",
        "entity_id",
        "service",
        "project",
        "device_id",
        "action",
      );
      return oneline(semanticTarget || fallbackTarget(event) || event.tool);
    }
  }
}

export interface ToolCallPresentation {
  kind: ToolKind;
  action: string;
  target: string;
  icon: LucideIcon;
  /**
   * The call errored on the wire but the outcome is a USER CHOICE, not a
   * failure (an ask wait the user dismissed) — rows render it neutral, not
   * destructive.
   */
  quietFailure?: boolean;
}

/** One answer item from the ask tool's result JSON. */
interface AskAnswer {
  id: string;
  selected: string[];
  custom?: string;
}

function parseAskAnswers(value: unknown): AskAnswer[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultText(decodeToolResult(value)));
  } catch {
    return null;
  }
  const answers = recordOf(parsed)?.answers;
  if (!Array.isArray(answers)) return null;
  const items: AskAnswer[] = [];
  for (const entry of answers) {
    const record = recordOf(entry);
    if (!record || typeof record.id !== "string") return null;
    items.push({
      id: record.id,
      selected: Array.isArray(record.selected)
        ? record.selected.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      ...(typeof record.custom === "string" ? { custom: record.custom } : {}),
    });
  }
  return items;
}

/** The ask wait the user dismissed — encoded as a tool error on the wire. */
function isCancelledAskUser(event: ToolProgress): boolean {
  return (
    event.tool === "ask_user_question" &&
    Boolean(event.error) &&
    /cancelled ask_user_question/i.test(resultText(event.result))
  );
}

function askUserTarget(event: ToolProgress, t: TranslateFn): string {
  if (isCancelledAskUser(event)) return t("sidepanel.trace.ask.cancelled");
  if (event.status === "running") return t("sidepanel.trace.ask.waiting");
  if (event.error) return "";
  const answers = parseAskAnswers(event.result);
  if (!answers || answers.length === 0) return "";
  const answered = answers.filter(
    (answer) =>
      answer.selected.length > 0 || (answer.custom ?? "").trim() !== "",
  ).length;
  return t("sidepanel.trace.ask.answered", {
    answered,
    total: answers.length,
  });
}

export function describeToolCall(
  event: ToolProgress,
  t: TranslateFn,
): ToolCallPresentation {
  const spec = TOOL_SPECS[event.tool] ?? GENERIC_SPEC;
  if (spec.kind === "ask-user") {
    return {
      kind: spec.kind,
      action: t(spec.actionKey),
      target: askUserTarget(event, t),
      icon: spec.icon,
      ...(isCancelledAskUser(event) ? { quietFailure: true } : {}),
    };
  }
  return {
    kind: spec.kind,
    action: t(spec.actionKey),
    target: targetFor(event, spec),
    icon: spec.icon,
  };
}

export function hasToolDetail(event: ToolProgress): boolean {
  const spec = TOOL_SPECS[event.tool] ?? GENERIC_SPEC;
  const args = parsedArgs(event);
  const output = resultText(event.result);
  const failed = Boolean(event.error);

  switch (spec.kind) {
    // Loading a skill and manipulating the browser are implementation steps,
    // not evidence. Successful calls stay as one quiet row.
    case "skill":
    case "browser-input":
      return failed;
    case "read-file":
      return failed || Boolean(output);
    case "search-files":
      return failed || event.result !== undefined;
    case "write-file":
      return (
        failed ||
        Boolean(event.inlineDiff?.trim()) ||
        Boolean(stringValue(args, "patch", "content"))
      );
    case "terminal":
    case "background-job":
      return failed || Boolean(output);
    case "code":
      return failed || Boolean(output) || Boolean(stringValue(args, "code"));
    case "web-search":
    case "web":
    case "browser":
      return failed || Boolean(output) || collectLinks(event.result).length > 0;
    case "delegation":
      return (
        failed ||
        (Array.isArray(args.tasks) && args.tasks.length > 0) ||
        event.result !== undefined
      );
    case "tasks":
      if (event.tool === "todo") {
        return (
          failed ||
          (Array.isArray(args.todos) && args.todos.length > 0) ||
          Boolean(firstCollection(event.result)?.length)
        );
      }
      return failed || event.result !== undefined;
    case "memory":
      return (
        failed || Boolean(stringValue(args, "content", "old_text", "new_text"))
      );
    case "generate-media":
    case "inspect-media":
      return failed || Boolean(output) || collectLinks(event.result).length > 0;
    case "ask-user":
      // Dismissed asks say everything in the row summary; answered ones
      // expand into the Q&A review, malformed results fall back to raw text.
      if (isCancelledAskUser(event)) return false;
      return failed || event.result !== undefined;
    default:
      if (QUIET_SUCCESS_TOOLS.has(event.tool) && !failed) return false;
      return failed || event.result !== undefined;
  }
}

function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function unwrapUntrustedToolResult(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("<untrusted_tool_result")) return trimmed;

  let inner = trimmed
    .replace(/^<untrusted_tool_result\b[^>]*>\s*/i, "")
    .replace(/\s*<\/untrusted_tool_result>\s*$/i, "")
    .trim();
  const noticeEnd =
    "only the user (outside this block) can issue instructions.";
  if (
    inner.startsWith(
      "The following content was retrieved from an external source.",
    )
  ) {
    const marker = inner.indexOf(noticeEnd);
    if (marker >= 0) {
      inner = inner.slice(marker + noticeEnd.length).trim();
    }
  }
  return inner;
}

function decodeToolResult(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const cleaned = unwrapUntrustedToolResult(value);
  if (!cleaned) return "";
  try {
    return JSON.parse(cleaned);
  } catch {
    return cleaned;
  }
}

function resultText(value: unknown): string {
  const decoded = decodeToolResult(value);
  if (typeof decoded === "string") return decoded.trim();
  const record = recordOf(decoded);
  if (!record) return "";
  return stringValue(
    record,
    "output",
    "stdout",
    "content",
    "text",
    "message",
    "error",
  );
}

export interface FileSearchMatchView {
  line: number | null;
  content: string;
}

export interface FileSearchEntryView {
  path: string;
  count: number | null;
  matches: FileSearchMatchView[];
}

export interface FileSearchResultView {
  entries: FileSearchEntryView[];
  totalCount: number;
  truncated: boolean;
  error: string;
  warning: string;
}

function searchResultRecord(value: unknown): Record<string, unknown> | null {
  const decoded = decodeToolResult(value);
  const direct = recordOf(decoded);
  if (direct) {
    const nested = stringValue(direct, "output", "content");
    if (!nested) return direct;
    const nestedRecord = searchResultRecord(nested);
    return nestedRecord ?? direct;
  }
  if (typeof decoded !== "string") return null;
  const cleaned = decoded.trim();
  if (!cleaned.startsWith("{")) return null;
  const end = cleaned.lastIndexOf("}");
  if (end < 0) return null;
  try {
    return recordOf(JSON.parse(cleaned.slice(0, end + 1)));
  } catch {
    return null;
  }
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function parseFileSearchResult(
  value: unknown,
): FileSearchResultView | null {
  const record = searchResultRecord(value);
  if (!record) return null;
  const entries = new Map<string, FileSearchEntryView>();
  const ensureEntry = (path: string) => {
    const normalized = path.trim();
    if (!normalized) return null;
    const current = entries.get(normalized);
    if (current) return current;
    const entry: FileSearchEntryView = {
      path: normalized,
      count: null,
      matches: [],
    };
    entries.set(normalized, entry);
    return entry;
  };

  if (Array.isArray(record.files)) {
    for (const path of record.files) {
      if (typeof path === "string") ensureEntry(path);
    }
  }

  if (Array.isArray(record.matches)) {
    for (const item of record.matches) {
      const match = recordOf(item);
      if (!match) continue;
      const entry = ensureEntry(stringValue(match, "path", "file", "filepath"));
      if (!entry) continue;
      entry.matches.push({
        line: numericValue(match.line ?? match.line_number),
        content: stringValue(match, "content", "text", "match"),
      });
    }
  }

  const denseMatches = stringValue(record, "matches_text");
  if (denseMatches) {
    let current: FileSearchEntryView | null = null;
    for (const row of denseMatches.split(/\r?\n/)) {
      const match = row.match(/^\s{2,}(\d+):\s?(.*)$/);
      if (match && current) {
        current.matches.push({
          line: Number(match[1]),
          content: match[2] ?? "",
        });
      } else if (row.trim()) {
        current = ensureEntry(row.trim());
      }
    }
  }

  const counts = recordOf(record.counts);
  if (counts) {
    for (const [path, value] of Object.entries(counts)) {
      const entry = ensureEntry(path);
      if (entry) entry.count = numericValue(value);
    }
  }

  const totalCount =
    numericValue(record.total_count) ??
    Array.from(entries.values()).reduce(
      (total, entry) =>
        total + (entry.count ?? Math.max(1, entry.matches.length)),
      0,
    );

  if (
    entries.size === 0 &&
    totalCount === 0 &&
    !stringValue(record, "error", "warning", "_warning")
  ) {
    return {
      entries: [],
      totalCount: 0,
      truncated: Boolean(record.truncated),
      error: "",
      warning: "",
    };
  }

  return {
    entries: Array.from(entries.values()),
    totalCount,
    truncated: Boolean(record.truncated),
    error: stringValue(record, "error"),
    warning: stringValue(record, "warning", "_warning", "limit_reason"),
  };
}

function exitCode(value: unknown): string {
  const record = recordOf(value);
  if (!record) return "";
  return stringValue(record, "exit_code", "exitCode", "code");
}

/**
 * The answered ask reviewed as question → answer pairs: selected options as
 * quiet chips, the custom answer as text, a skipped question marked as such.
 * Question copy comes from the call ARGS (the result carries only ids).
 */
function AskUserEvidence({
  answers,
  args,
  t,
}: {
  answers: AskAnswer[];
  args: Record<string, unknown>;
  t: TranslateFn;
}) {
  const questionById = new Map<string, string>();
  if (Array.isArray(args.questions)) {
    for (const entry of args.questions) {
      const record = recordOf(entry);
      if (
        record &&
        typeof record.id === "string" &&
        typeof record.question === "string"
      ) {
        questionById.set(record.id, record.question);
      }
    }
  }
  return (
    <section className="overflow-hidden rounded-lg border border-border/40 bg-muted/[0.06] px-2.5 py-2">
      <div className="space-y-2">
        {answers.map((answer, index) => {
          const custom = (answer.custom ?? "").trim();
          const skipped = answer.selected.length === 0 && custom === "";
          return (
            <div key={answer.id || index} className="min-w-0">
              <p className="text-[10.5px] leading-relaxed text-muted-foreground">
                {questionById.get(answer.id) ?? answer.id}
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-1">
                {answer.selected.map((label) => (
                  <span
                    key={label}
                    className="rounded-md bg-primary/[0.08] px-1.5 py-0.5 text-[11px] font-medium leading-snug text-foreground/85 ring-1 ring-primary/25"
                  >
                    {label}
                  </span>
                ))}
                {custom !== "" && (
                  <span className="min-w-0 break-words text-[11px] leading-relaxed text-foreground/85">
                    {custom}
                  </span>
                )}
                {skipped && (
                  <span className="text-[11px] text-muted-foreground/60">
                    {t("sidepanel.trace.ask.skipped")}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DetailShell({
  kind,
  children,
}: {
  kind: ToolKind;
  children: ReactNode;
}) {
  return (
    <div data-tool-detail={kind} className="mt-1 w-full max-w-2xl min-w-0">
      {children}
    </div>
  );
}

function CodeEvidence({
  text,
  tone = "default",
}: {
  text: string;
  tone?: "default" | "error";
}) {
  if (!text.trim()) return null;
  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-border/45 bg-muted/20">
      <pre
        className={cn(
          "max-h-72 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[10.5px] leading-[1.6]",
          tone === "error" ? "text-destructive/85" : "text-foreground/75",
        )}
      >
        {text}
      </pre>
    </section>
  );
}

function stripAnsi(value: string): string {
  return value.replace(new RegExp("\\x1B\\[[0-?]*[ -/]*[@-~]", "g"), "");
}

function DiffEvidence({ diff }: { diff: string }) {
  const lines = stripAnsi(diff).split("\n");
  return (
    <section className="overflow-hidden rounded-md border border-border/45 bg-muted/15">
      <pre className="max-h-80 overflow-auto py-1.5 font-mono text-[10.5px] leading-[1.55]">
        {lines.map((line, index) => {
          const added = line.startsWith("+") && !line.startsWith("+++");
          const removed = line.startsWith("-") && !line.startsWith("---");
          const hunk = line.startsWith("@@");
          return (
            <div
              key={`${index}:${line}`}
              className={cn(
                "min-h-[1.55em] whitespace-pre-wrap break-all px-3",
                added &&
                  "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                removed && "bg-red-500/10 text-red-700 dark:text-red-300",
                hunk && "text-muted-foreground/65",
                !added && !removed && !hunk && "text-foreground/70",
              )}
            >
              {line || " "}
            </div>
          );
        })}
      </pre>
    </section>
  );
}

interface LinkEvidence {
  url: string;
  title: string;
  snippet?: string;
}

function readableWebText(value: string): string {
  return unwrapUntrustedToolResult(value)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function headingFromWebText(value: string): string {
  const unwrapped = unwrapUntrustedToolResult(value);
  const heading = unwrapped.match(/^\s{0,3}#{1,3}\s+(.+)$/m)?.[1];
  return heading
    ? oneline(heading.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"), 90)
    : "";
}

function displayWebLocation(url: string): string {
  try {
    const parsed = new URL(url);
    const path = decodeURIComponent(`${parsed.pathname}${parsed.search}`);
    return `${parsed.hostname}${path === "/" ? "" : path}`;
  } catch {
    return url;
  }
}

function collectLinks(
  value: unknown,
  out: LinkEvidence[] = [],
  depth = 0,
): LinkEvidence[] {
  if (depth > 4 || out.length >= 6) return out;
  const decoded = decodeToolResult(value);
  if (Array.isArray(decoded)) {
    for (const item of decoded) collectLinks(item, out, depth + 1);
    return out;
  }
  const record = recordOf(decoded);
  if (!record) return out;
  const rawUrl = stringValue(record, "url", "href", "link");
  const url = rawUrl ? safeUrl(rawUrl) : null;
  if (url && !out.some((item) => item.url === url)) {
    const rawContent = stringValue(
      record,
      "snippet",
      "description",
      "summary",
      "content",
    );
    const explicitTitle = stringValue(record, "title", "name");
    const derivedTitle = headingFromWebText(rawContent);
    let snippet = readableWebText(rawContent);
    if (!explicitTitle && derivedTitle && snippet.startsWith(derivedTitle)) {
      snippet = snippet.slice(derivedTitle.length).trim();
    }
    out.push({
      url,
      title: explicitTitle || derivedTitle || hostname(url),
      snippet: oneline(snippet, 260) || undefined,
    });
  }
  for (const child of Object.values(record)) {
    collectLinks(child, out, depth + 1);
  }
  return out;
}

function LinkList({ links }: { links: LinkEvidence[] }) {
  if (links.length === 0) return null;
  return (
    <section className="space-y-1.5">
      {links.map((link) => (
        <a
          key={link.url}
          href={link.url}
          target="_blank"
          rel="noreferrer"
          className="group/link grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)_0.875rem] items-start gap-2.5 rounded-lg border border-border/45 bg-muted/10 px-3 py-2.5 transition-colors hover:border-border/70 hover:bg-muted/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <span
            aria-hidden
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border/40 bg-background/60 text-muted-foreground/55"
          >
            <Globe className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium leading-5 text-foreground/85">
              {link.title}
            </span>
            <span className="block truncate text-[10.5px] leading-4 text-muted-foreground/55">
              {displayWebLocation(link.url)}
            </span>
            {link.snippet && (
              <span className="mt-1 block line-clamp-2 text-[11px] leading-[1.55] text-muted-foreground/75">
                {link.snippet}
              </span>
            )}
          </span>
          <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/35 transition-colors group-hover/link:text-muted-foreground/65" />
        </a>
      ))}
    </section>
  );
}

function fileSearchPathParts(path: string): {
  name: string;
  parent: string;
} {
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
  return {
    name: parts.at(-1) ?? path,
    parent: parts.slice(Math.max(0, parts.length - 4), -1).join("/"),
  };
}

function FileSearchEvidence({
  value,
  fallbackText,
  failed,
  onOpenFile,
  t,
}: {
  value: unknown;
  fallbackText: string;
  failed: boolean;
  onOpenFile?: (path: string, line?: number) => void;
  t: TranslateFn;
}) {
  const result = parseFileSearchResult(value);
  if (!result) {
    return (
      <CodeEvidence text={fallbackText} tone={failed ? "error" : "default"} />
    );
  }
  if (result.error) {
    return <CodeEvidence text={result.error} tone="error" />;
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border/40 bg-muted/[0.06] p-1.5">
      <div className="flex h-6 items-center gap-1.5 px-1.5 text-[10px] text-muted-foreground">
        <FolderSearch className="h-3 w-3" />
        <span>
          {t("sidepanel.trace.searchResults.count", {
            count: result.totalCount,
          })}
        </span>
        {result.truncated && (
          <span className="ml-auto">
            {t("sidepanel.trace.searchResults.truncated")}
          </span>
        )}
      </div>
      {result.entries.length > 0 ? (
        <div className="max-h-80 overflow-y-auto overscroll-contain">
          {result.entries.slice(0, 30).map((entry) => {
            const path = fileSearchPathParts(entry.path);
            const firstLine = entry.matches.find(
              (match) => match.line !== null,
            )?.line;
            const matchCount = entry.count ?? entry.matches.length;
            return (
              <button
                key={entry.path}
                type="button"
                disabled={!onOpenFile}
                onClick={() => onOpenFile?.(entry.path, firstLine ?? undefined)}
                title={
                  onOpenFile
                    ? t("sidepanel.trace.searchResults.openFile")
                    : entry.path
                }
                className={cn(
                  "group/search-result flex min-h-7 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left",
                  onOpenFile &&
                    "transition-colors hover:bg-muted/40 focus:outline-none focus-visible:bg-muted/40",
                )}
              >
                <FileCode2 className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                <span className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden whitespace-nowrap font-mono">
                  <span className="max-w-[55%] shrink-0 truncate text-[10.5px] font-medium text-foreground/78">
                    {path.name}
                  </span>
                  {path.parent && (
                    <span className="min-w-0 truncate text-[9.5px] text-muted-foreground/48">
                      {path.parent}
                    </span>
                  )}
                </span>
                {matchCount > 0 && (
                  <span className="shrink-0 font-mono text-[9.5px] tabular-nums text-muted-foreground/50">
                    {t("sidepanel.trace.searchResults.matches", {
                      count: matchCount,
                    })}
                  </span>
                )}
                {onOpenFile && (
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/30 transition-transform group-hover/search-result:translate-x-0.5" />
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="px-2 py-3 text-center text-[10px] text-muted-foreground">
          {t("sidepanel.trace.searchResults.empty")}
        </div>
      )}
      {result.warning && (
        <div className="border-t border-border/35 px-3 py-1.5 text-[9.5px] text-muted-foreground/65">
          {result.warning}
        </div>
      )}
    </section>
  );
}

function StructuredValue({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}) {
  if (value == null) return <span className="text-muted-foreground/60">—</span>;
  if (typeof value === "string") {
    return value.includes("\n") || value.length > 120 ? (
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[10.5px] leading-[1.55] text-foreground/70">
        {value}
      </pre>
    ) : (
      <span className="break-all font-mono text-foreground/75">{value}</span>
    );
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return (
      <span className="font-mono text-foreground/75">{String(value)}</span>
    );
  }
  if (Array.isArray(value)) {
    return (
      <div className="space-y-1">
        {value.slice(0, 20).map((item, index) => (
          <div key={index} className="flex min-w-0 gap-2">
            <span className="shrink-0 font-mono text-muted-foreground/45">
              {index + 1}.
            </span>
            <div className="min-w-0 flex-1">
              <StructuredValue value={item} depth={depth + 1} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  const record = recordOf(value);
  if (!record || depth >= 3) {
    return <span className="text-muted-foreground/60">[…]</span>;
  }
  return (
    <dl className="space-y-1.5">
      {Object.entries(record)
        .slice(0, 30)
        .map(([key, item]) => (
          <div
            key={key}
            className="grid min-w-0 gap-1 sm:grid-cols-[7rem_minmax(0,1fr)]"
          >
            <dt className="truncate font-mono text-muted-foreground/55">
              {key}
            </dt>
            <dd className="min-w-0">
              <StructuredValue value={item} depth={depth + 1} />
            </dd>
          </div>
        ))}
    </dl>
  );
}

function StructuredEvidence({ value }: { value: unknown }) {
  if (
    value == null ||
    (recordOf(value) && Object.keys(recordOf(value)!).length === 0)
  ) {
    return null;
  }
  return (
    <section className="overflow-hidden rounded-md border border-border/45 bg-muted/15">
      <div className="px-3 py-2 text-[11px]">
        <StructuredValue value={value} />
      </div>
    </section>
  );
}

function TerminalEvidence({
  command,
  output,
  workdir,
  exit,
  failed,
}: {
  command: string;
  output: string;
  workdir: string;
  exit: string;
  failed: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-border/45 bg-muted/20">
      <pre
        className={cn(
          "max-h-80 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[10.5px] leading-[1.65]",
          failed ? "text-destructive/85" : "text-foreground/75",
        )}
      >
        {command ? `$ ${command}` : ""}
        {command && output ? "\n\n" : ""}
        {output}
      </pre>
      {(workdir || (exit && exit !== "0")) && (
        <div className="flex min-w-0 items-center justify-end gap-2 px-3 pb-2 font-mono text-[9.5px] text-muted-foreground/45">
          {workdir && <span className="min-w-0 truncate">{workdir}</span>}
          {exit && exit !== "0" && (
            <span className="shrink-0 text-destructive/80">exit {exit}</span>
          )}
        </div>
      )}
    </section>
  );
}

function CodeRunEvidence({
  code,
  output,
  workdir,
  failed,
}: {
  code: string;
  output: string;
  workdir: string;
  failed: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-border/45 bg-muted/20">
      {code && (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[10.5px] leading-[1.6] text-foreground/75">
          {code}
        </pre>
      )}
      {output && (
        <pre
          className={cn(
            "max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-border/35 px-3 py-2 font-mono text-[10.5px] leading-[1.6]",
            failed ? "text-destructive/85" : "text-muted-foreground/80",
          )}
        >
          {output}
        </pre>
      )}
      {workdir && (
        <div className="truncate px-3 pb-2 text-right font-mono text-[9.5px] text-muted-foreground/40">
          {workdir}
        </div>
      )}
    </section>
  );
}

function TodoEvidence({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return null;
  return (
    <ul className="overflow-hidden rounded-md border border-border/45 bg-muted/15">
      {value.slice(0, 30).map((item, index) => {
        const record = recordOf(item);
        const text =
          typeof item === "string"
            ? item
            : record
              ? stringValue(record, "content", "title", "task", "goal", "name")
              : String(item);
        const status = record ? stringValue(record, "status", "state") : "";
        const done =
          record?.completed === true ||
          ["done", "completed", "complete"].includes(status.toLowerCase());
        return (
          <li
            key={`${index}:${text}`}
            className="flex min-w-0 items-start gap-2 border-b border-border/30 px-3 py-2 text-[11px] last:border-b-0"
          >
            <span
              aria-hidden
              className={cn(
                "mt-[0.35em] h-1.5 w-1.5 shrink-0 rounded-full",
                done
                  ? "bg-emerald-500/70"
                  : "border border-muted-foreground/45",
              )}
            />
            <span
              className={cn(
                "min-w-0 break-words text-foreground/75",
                done && "text-muted-foreground line-through",
              )}
            >
              {text || "—"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function firstCollection(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  const record = recordOf(value);
  if (!record) return null;
  for (const key of [
    "items",
    "results",
    "tasks",
    "todos",
    "jobs",
    "cards",
    "records",
    "attachments",
  ]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return null;
}

function CollectionEvidence({ value }: { value: unknown }) {
  const items = firstCollection(value);
  if (!items || items.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-md border border-border/45 bg-muted/15">
      {items.slice(0, 30).map((item, index) => {
        const record = recordOf(item);
        const primary =
          typeof item === "string"
            ? item
            : record
              ? stringValue(
                  record,
                  "title",
                  "name",
                  "content",
                  "goal",
                  "id",
                  "task_id",
                  "url",
                )
              : String(item);
        const secondary = record
          ? stringValue(
              record,
              "status",
              "schedule",
              "cron",
              "next_run",
              "role",
            )
          : "";
        return (
          <div
            key={`${index}:${primary}`}
            className="flex min-w-0 items-start gap-2 border-b border-border/30 px-3 py-2 text-[11px] last:border-b-0"
          >
            <span className="mt-[0.15em] shrink-0 font-mono text-[10px] text-muted-foreground/40">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 break-words text-foreground/75">
              {primary || "—"}
            </span>
            {secondary && (
              <span className="max-w-[40%] shrink-0 truncate text-muted-foreground/55">
                {secondary}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DelegationEvidence({
  tasks,
  result,
  failed,
}: {
  tasks: unknown;
  result: unknown;
  failed: boolean;
}) {
  const output = resultText(result);
  return (
    <div className="space-y-1.5">
      {Array.isArray(tasks) && (
        <div className="overflow-hidden rounded-md border border-border/45 bg-muted/15">
          {tasks.slice(0, 20).map((task, index) => {
            const record = recordOf(task);
            const goal = record
              ? stringValue(record, "goal", "task", "title")
              : String(task);
            const role = record ? stringValue(record, "role", "name") : "";
            return (
              <div
                key={`${index}:${goal}`}
                className="flex min-w-0 gap-2 border-b border-border/30 px-3 py-2 text-[11px] last:border-b-0"
              >
                <span className="shrink-0 font-mono text-muted-foreground/45">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 break-words text-foreground/75">
                  {goal || "—"}
                </span>
                {role && (
                  <span className="shrink-0 text-muted-foreground/55">
                    {role}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {output ? (
        <CodeEvidence text={output} tone={failed ? "error" : "default"} />
      ) : (
        result !== undefined &&
        !Array.isArray(tasks) && <StructuredEvidence value={result} />
      )}
    </div>
  );
}

export function ToolDetail({
  event,
  t,
}: {
  event: ToolProgress;
  t: TranslateFn;
}) {
  const workspacePane = useWorkspacePane();
  const presentation = describeToolCall(event, t);
  const args = parsedArgs(event);
  const result = decodeToolResult(event.result);
  const output = resultText(result);
  const workdir = stringValue(args, "workdir", "cwd");
  const url = stringValue(args, "url", "href") || firstListString(args.urls);
  const command = stringValue(args, "command");
  const code = stringValue(args, "code");

  if (presentation.kind === "terminal") {
    return (
      <DetailShell kind={presentation.kind}>
        <TerminalEvidence
          command={command || fallbackTarget(event)}
          output={output}
          workdir={workdir}
          exit={exitCode(result)}
          failed={Boolean(event.error)}
        />
      </DetailShell>
    );
  }

  if (presentation.kind === "code") {
    return (
      <DetailShell kind={presentation.kind}>
        <CodeRunEvidence
          code={code}
          output={output}
          workdir={workdir}
          failed={Boolean(event.error)}
        />
      </DetailShell>
    );
  }

  if (presentation.kind === "read-file") {
    return (
      <DetailShell kind={presentation.kind}>
        <CodeEvidence text={output} tone={event.error ? "error" : "default"} />
      </DetailShell>
    );
  }

  if (presentation.kind === "ask-user") {
    const answers = parseAskAnswers(event.result);
    return (
      <DetailShell kind={presentation.kind}>
        {answers ? (
          <AskUserEvidence answers={answers} args={args} t={t} />
        ) : (
          <CodeEvidence
            text={output}
            tone={event.error ? "error" : "default"}
          />
        )}
      </DetailShell>
    );
  }

  if (presentation.kind === "write-file") {
    return (
      <DetailShell kind={presentation.kind}>
        <div className="space-y-1.5">
          {event.inlineDiff?.trim() ? (
            <DiffEvidence diff={event.inlineDiff} />
          ) : (
            <CodeEvidence text={stringValue(args, "patch", "content")} />
          )}
          {event.error && <CodeEvidence text={output} tone="error" />}
        </div>
      </DetailShell>
    );
  }

  if (
    presentation.kind === "web-search" ||
    presentation.kind === "web" ||
    presentation.kind === "browser" ||
    presentation.kind === "browser-input"
  ) {
    const links = collectLinks(result);
    const resultRecord = recordOf(result);
    const directUrl = url ? safeUrl(url) : null;
    if (directUrl && !links.some((link) => link.url === directUrl)) {
      links.unshift({
        url: directUrl,
        title:
          (resultRecord && stringValue(resultRecord, "title", "name")) ||
          hostname(directUrl),
        snippet: output ? oneline(output, 260) : undefined,
      });
    } else if (links.length > 0 && output && !links[0]?.snippet) {
      links[0] = { ...links[0], snippet: oneline(output, 260) };
    }
    return (
      <DetailShell kind={presentation.kind}>
        <LinkList links={links} />
        {links.length === 0 && output && (
          <CodeEvidence
            text={output}
            tone={event.error ? "error" : "default"}
          />
        )}
        {links.length === 0 && !output && <StructuredEvidence value={result} />}
      </DetailShell>
    );
  }

  if (presentation.kind === "search-files") {
    return (
      <DetailShell kind={presentation.kind}>
        <FileSearchEvidence
          value={event.result}
          fallbackText={output}
          failed={Boolean(event.error)}
          onOpenFile={
            workspacePane.enabled
              ? (path, line) => workspacePane.openFile(path, line)
              : undefined
          }
          t={t}
        />
      </DetailShell>
    );
  }

  if (presentation.kind === "delegation") {
    return (
      <DetailShell kind={presentation.kind}>
        <DelegationEvidence
          tasks={args.tasks}
          result={result}
          failed={Boolean(event.error)}
        />
      </DetailShell>
    );
  }

  if (presentation.kind === "tasks") {
    const resultRecord = recordOf(result);
    const todos = resultRecord?.todos ?? args.todos;
    const resultCollection = firstCollection(result);
    return (
      <DetailShell kind={presentation.kind}>
        <div className="space-y-1.5">
          {event.tool === "todo" ? (
            <TodoEvidence value={todos} />
          ) : (
            <CollectionEvidence value={result} />
          )}
          {(event.error || (event.tool !== "todo" && !resultCollection)) && (
            <StructuredEvidence value={result} />
          )}
        </div>
      </DetailShell>
    );
  }

  if (presentation.kind === "skill") {
    return (
      <DetailShell kind={presentation.kind}>
        {event.error && output ? (
          <CodeEvidence text={output} tone="error" />
        ) : (
          event.error && <StructuredEvidence value={result} />
        )}
      </DetailShell>
    );
  }

  if (presentation.kind === "memory") {
    const action = stringValue(args, "action");
    const oldText = stringValue(args, "old_text");
    const newText =
      stringValue(args, "new_text") ||
      (action === "add" ? stringValue(args, "content") : "");
    const diff = [oldText ? `-${oldText}` : "", newText ? `+${newText}` : ""]
      .filter(Boolean)
      .join("\n");
    return (
      <DetailShell kind={presentation.kind}>
        {diff ? (
          <DiffEvidence diff={diff} />
        ) : output ? (
          <CodeEvidence
            text={output}
            tone={event.error ? "error" : "default"}
          />
        ) : (
          <StructuredEvidence value={result} />
        )}
      </DetailShell>
    );
  }

  if (
    presentation.kind === "generate-media" ||
    presentation.kind === "inspect-media"
  ) {
    const links = collectLinks(result);
    return (
      <DetailShell kind={presentation.kind}>
        <LinkList links={links} />
        {links.length === 0 && output ? (
          <CodeEvidence
            text={output}
            tone={event.error ? "error" : "default"}
          />
        ) : (
          links.length === 0 && <StructuredEvidence value={result} />
        )}
      </DetailShell>
    );
  }

  return (
    <DetailShell kind={presentation.kind}>
      {output ? (
        <CodeEvidence text={output} tone={event.error ? "error" : "default"} />
      ) : (
        <StructuredEvidence value={result ?? args} />
      )}
    </DetailShell>
  );
}
