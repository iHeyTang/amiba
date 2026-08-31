import type { ToolCallOwnerProps } from "@amiba/extension-sdk";
import { useT, type TranslateFn } from "@amiba/i18n";
import {
  CodeEvidence,
  DiffEvidence,
  EvidenceShell,
  TerminalEvidence,
  TodoEvidence,
  ToolRowFrame,
  hostnameOf,
  oneline,
  stringValue,
  toolCallArgs,
  toolCallDurationMs,
  toolCallFailed,
  toolCallResultText,
  toolCallSettled,
  toolCallStartedAt,
  unwrapUntrustedToolResult,
} from "@amiba/ui/plugin";
import {
  BookOpen,
  Eye,
  FilePenLine,
  FileText,
  FolderSearch,
  Globe,
  ListTodo,
  ClipboardList,
  AlarmClock,
  Repeat2,
  Search,
  Target,
  Terminal,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

/**
 * The OFFICIAL runtime tools' timeline rows — ui-shell's occupants of the
 * keyed `tool.call.toolview` seat, one registration per wire name. This is
 * where the product presentation of the DSH standard preset's tools lives:
 * core `@amiba/ui` knows no tool names (its fallback row is generic by
 * construction), and every Amiba plugin registers its OWN tools the same
 * way this module registers the runtime's.
 */

interface EvidenceContext {
  args: Record<string, unknown>;
  /** Unwrapped result text (untrusted envelopes stripped). */
  text: string;
  t: TranslateFn;
}

interface OfficialToolviewSpec {
  icon: LucideIcon;
  action: Parameters<TranslateFn>[0];
  target?: (args: Record<string, unknown>) => string;
  /** Success evidence; failures always show the error text instead. */
  evidence?: (ctx: EvidenceContext) => ReactNode | null;
  /** Implementation-step tools: expand only when the call failed. */
  quietSuccess?: boolean;
}

/** `-old / +new` pseudo-diff for the edit tool's argument pair. */
function editDiff(args: Record<string, unknown>): string {
  const oldText = stringValue(args, "old_string");
  const newText = stringValue(args, "new_string");
  if (!oldText && !newText) return "";
  return [
    ...oldText.split("\n").map((line) => `-${line}`),
    ...newText.split("\n").map((line) => `+${line}`),
  ].join("\n");
}

const filePathTarget = (args: Record<string, unknown>) =>
  stringValue(args, "file_path", "path");

const codeText = (ctx: EvidenceContext) =>
  ctx.text ? <CodeEvidence text={ctx.text} /> : null;

const SPECS: Record<string, OfficialToolviewSpec> = {
  bash: {
    icon: Terminal,
    action: "shell.tool.runCommand",
    target: (args) => oneline(stringValue(args, "command")),
    evidence: (ctx) => (
      <TerminalEvidence
        command={stringValue(ctx.args, "command")}
        output={ctx.text}
        workdir={stringValue(ctx.args, "workdir", "cwd")}
      />
    ),
  },
  read: {
    icon: FileText,
    action: "shell.tool.readFile",
    target: filePathTarget,
    evidence: codeText,
  },
  read_image: {
    icon: Eye,
    action: "shell.tool.inspectImage",
    target: filePathTarget,
    quietSuccess: true,
  },
  edit: {
    icon: FilePenLine,
    action: "shell.tool.editFile",
    target: filePathTarget,
    evidence: (ctx) => {
      const diff = editDiff(ctx.args);
      return diff ? <DiffEvidence diff={diff} /> : codeText(ctx);
    },
  },
  write: {
    icon: FilePenLine,
    action: "shell.tool.writeFile",
    target: filePathTarget,
    evidence: (ctx) => {
      const content = stringValue(ctx.args, "content");
      return content ? <CodeEvidence text={content} /> : codeText(ctx);
    },
  },
  grep: {
    icon: FolderSearch,
    action: "shell.tool.searchFiles",
    target: (args) => oneline(stringValue(args, "pattern")),
    evidence: codeText,
  },
  glob: {
    icon: FolderSearch,
    action: "shell.tool.searchFiles",
    target: (args) => oneline(stringValue(args, "pattern")),
    evidence: codeText,
  },
  todo_write: {
    icon: ListTodo,
    action: "shell.tool.updateTasks",
    target: (args) =>
      Array.isArray(args.todos) ? String(args.todos.length) : "",
    evidence: (ctx) => <TodoEvidence value={ctx.args.todos} />,
  },
  skill: {
    icon: BookOpen,
    action: "shell.tool.useSkill",
    target: (args) => oneline(stringValue(args, "name", "path", "url")),
    quietSuccess: true,
  },
  web_search: {
    icon: Search,
    action: "shell.tool.searchWeb",
    target: (args) => oneline(stringValue(args, "query", "q")),
    evidence: codeText,
  },
  web_fetch: {
    icon: Globe,
    action: "shell.tool.readWeb",
    target: (args) => {
      const url = stringValue(args, "url", "href");
      return url ? hostnameOf(url) : "";
    },
    evidence: codeText,
  },
  job_output: {
    icon: Terminal,
    action: "shell.tool.manageJobs",
    evidence: codeText,
  },
  job_list: {
    icon: Terminal,
    action: "shell.tool.manageJobs",
    evidence: codeText,
  },
  job_kill: {
    icon: Terminal,
    action: "shell.tool.manageJobs",
    evidence: codeText,
  },
  create_goal: {
    icon: Target,
    action: "shell.tool.manageGoal",
    target: (args) => oneline(stringValue(args, "name", "title", "goal")),
    evidence: codeText,
  },
  get_goal: {
    icon: Target,
    action: "shell.tool.manageGoal",
    evidence: codeText,
  },
  update_goal: {
    icon: Target,
    action: "shell.tool.manageGoal",
    target: (args) => oneline(stringValue(args, "name", "title", "goal")),
    evidence: codeText,
  },
  subagent: {
    icon: Users,
    action: "shell.tool.delegate",
    target: (args) =>
      oneline(stringValue(args, "description", "prompt", "task"), 80),
    evidence: codeText,
  },
  subagent_fork: {
    icon: Users,
    action: "shell.tool.delegate",
    target: (args) =>
      oneline(stringValue(args, "description", "prompt", "task"), 80),
    evidence: codeText,
  },
  interrupt_agent: {
    icon: Users,
    action: "shell.tool.controlAgent",
    quietSuccess: true,
  },
  send_message: {
    icon: Users,
    action: "shell.tool.controlAgent",
    quietSuccess: true,
  },
  ralph: {
    icon: Repeat2,
    action: "shell.tool.runLoop",
    evidence: codeText,
  },
  plan: {
    icon: ClipboardList,
    action: "shell.tool.updatePlan",
    evidence: codeText,
  },
  schedule_create: {
    icon: AlarmClock,
    action: "shell.tool.manageReminders",
    target: (args) => oneline(stringValue(args, "prompt", "message"), 80),
    evidence: codeText,
  },
  schedule_list: {
    icon: AlarmClock,
    action: "shell.tool.manageReminders",
    evidence: codeText,
  },
  schedule_delete: {
    icon: AlarmClock,
    action: "shell.tool.manageReminders",
    evidence: codeText,
  },
};

function OfficialToolRow({
  spec,
  tag,
  owner,
}: {
  spec: OfficialToolviewSpec;
  tag: string;
  owner: ToolCallOwnerProps;
}) {
  const { t } = useT();
  const { block } = owner;
  const running = toolCallSettled(block) === null;
  // Live duration ticker, matching the built-in row's cadence.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  void tick;

  const args = toolCallArgs(block);
  const failed = toolCallFailed(block);
  const text = unwrapUntrustedToolResult(toolCallResultText(block));
  const startedAt = toolCallStartedAt(block);
  const durationMs = running
    ? startedAt !== undefined
      ? Date.now() - startedAt
      : undefined
    : toolCallDurationMs(block);
  const action = t(spec.action);
  const target = spec.target?.(args) ?? "";

  const body = failed
    ? text && <CodeEvidence text={text} tone="error" />
    : running || spec.quietSuccess
      ? null
      : (spec.evidence?.({ args, text, t }) ?? null);
  const detail = body ? <EvidenceShell tag={tag}>{body}</EvidenceShell> : undefined;

  return (
    <ToolRowFrame
      icon={spec.icon}
      action={action}
      target={target || undefined}
      {...(durationMs === undefined ? {} : { durationMs })}
      running={running}
      failed={failed}
      ariaLabel={[action, target].filter(Boolean).join(" ")}
      detail={detail}
    />
  );
}

/** One component per wire name, closing over its spec. */
export const OFFICIAL_TOOLVIEWS: Array<{
  key: string;
  component: (props: ToolCallOwnerProps) => ReactNode;
}> = Object.entries(SPECS).map(([key, spec]) => ({
  key,
  component: function OfficialToolview(props: ToolCallOwnerProps) {
    return <OfficialToolRow spec={spec} tag={key} owner={props} />;
  },
}));
