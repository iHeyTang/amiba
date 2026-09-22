import { RuntimeInspectEvidence } from "./runtime-inspect-evidence";
import type { ToolCallOwnerProps } from "@amiba/extension-sdk";
import { useT, type TranslateFn } from "@amiba/i18n";
import {
  SemanticToolRow,
  type SemanticToolSpec,
  type SemanticEvidenceContext,
  recordOf,
  CodeEvidence,
  DiffEvidence,
  TerminalEvidence,
  TodoEvidence,
  hostnameOf,
  oneline,
  stringValue,
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
} from "lucide-react";
import { type ReactNode } from "react";

/**
 * The OFFICIAL runtime tools' timeline rows — ui-shell's occupants of the
 * keyed `tool.call.toolview` seat, one registration per wire name. This is
 * where the product presentation of the DSH standard preset's tools lives:
 * core `@amiba/ui` knows no tool names (its fallback row is generic by
 * construction), and every Amiba plugin registers its OWN tools the same
 * way this module registers the runtime's.
 */

/** `-old / +new` pseudo-diff for the edit tool's argument pair. */
function editDiff(args: Record<string, unknown>): string {
  const oldText = typeof args.old_string === "string" ? args.old_string : "";
  const newText = typeof args.new_string === "string" ? args.new_string : "";
  if (!oldText && !newText) return "";
  return [
    ...oldText.split("\n").map((line) => `-${line}`),
    ...newText.split("\n").map((line) => `+${line}`),
  ].join("\n");
}

const filePathTarget = (args: Record<string, unknown>) =>
  stringValue(args, "file_path", "path");

const codeText = (ctx: SemanticEvidenceContext) =>
  ctx.text ? <CodeEvidence text={ctx.text} /> : null;

const SPECS: Record<string, SemanticToolSpec<Parameters<TranslateFn>[0]>> = {
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
    action: (args) => (args.wait ? "shell.tool.waitJob" : "shell.tool.readJob"),
    evidence: codeText,
  },
  job_list: {
    icon: Terminal,
    action: "shell.tool.listJobs",
    evidence: codeText,
  },
  job_kill: {
    icon: Terminal,
    action: "shell.tool.stopJob",
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

SPECS.pwsh = SPECS.bash!;
SPECS.subagent_codex = SPECS.subagent!;
SPECS.subagent_claude_code = SPECS.subagent!;
SPECS.run_code = {
  icon: Terminal,
  action: "shell.tool.runCode",
  target: (args) => oneline(stringValue(args, "title", "description", "code")),
  evidence: (ctx) => (
    <>
      <CodeEvidence text={stringValue(ctx.args, "code")} />
      {codeText(ctx)}
    </>
  ),
};
SPECS.exit_plan_mode = {
  icon: ClipboardList,
  action: "shell.tool.submitPlan",
  evidence: (ctx) => (
    <>
      <CodeEvidence text={stringValue(ctx.args, "plan")} />
      {codeText(ctx)}
    </>
  ),
};
SPECS.workflow = {
  icon: Repeat2,
  action: "shell.tool.runWorkflow",
  target: (args) =>
    oneline(
      stringValue(recordOf(args.meta) ?? {}, "name") ||
        stringValue(args, "name"),
    ),
  evidence: (ctx) => (
    <>
      <CodeEvidence text={stringValue(ctx.args, "code", "script")} />
      {codeText(ctx)}
    </>
  ),
};
SPECS.report = {
  icon: Users,
  action: "shell.tool.reportProgress",
  target: (args) => oneline(stringValue(args, "output", "message", "summary")),
  evidence: (ctx) => (
    <>
      <CodeEvidence
        text={stringValue(ctx.args, "output", "message", "summary")}
      />
      {codeText(ctx)}
    </>
  ),
};
SPECS.str_replace_editor = {
  icon: FilePenLine,
  action: (args) =>
    args.command === "view"
      ? "shell.tool.readFile"
      : args.command === "create"
        ? "shell.tool.writeFile"
        : "shell.tool.editFile",
  target: filePathTarget,
  evidence: (ctx) => {
    if (ctx.args.command === "str_replace") {
      const diff = editDiff({
        old_string: ctx.args.old_str,
        new_string: ctx.args.new_str,
      });
      return (
        <>
          <DiffEvidence diff={diff} />
          {codeText(ctx)}
        </>
      );
    }
    const content = stringValue(ctx.args, "file_text", "new_str");
    return (
      <>
        {content && <CodeEvidence text={content} />}
        {codeText(ctx)}
      </>
    );
  },
};
for (const key of [
  "cordis_inspect_list",
  "cordis_inspect_query",
  "cordis_inspect_self",
]) {
  SPECS[key] = {
    icon: Search,
    action: (args) =>
      args.provider === "Service" && args.method === "listService"
        ? "shell.inspect.serviceAction"
        : args.provider === "Theme" && args.method === "listTokens"
          ? "shell.inspect.themeAction"
          : "shell.tool.inspectRuntime",
    target: (args) =>
      oneline(
        [args.provider, args.method]
          .filter((value) => typeof value === "string" && value)
          .join(".") ||
          stringValue(args, "query", "name", "packageName", "pluginId"),
      ),
    evidence: (ctx) => <RuntimeInspectEvidence {...ctx} />,
  };
}
// Dynamic Cordis lifecycle rows belong to the official ui-cordis plugin.
// A generic success row would hide approval and activation state.

/** One component per wire name, closing over its spec. */
export const OFFICIAL_TOOLVIEWS: Array<{
  key: string;
  component: (props: ToolCallOwnerProps) => ReactNode;
}> = Object.entries(SPECS).map(([key, spec]) => ({
  key,
  component: function OfficialToolview(props: ToolCallOwnerProps) {
    const { t } = useT();
    return <SemanticToolRow spec={spec} tag={key} owner={props} t={t} />;
  },
}));

/** Intrinsic runtime rows need only the retained call, even while the
 * session-scoped slot is unavailable (selection handoff / plugin startup).
 * Reuse the registered components; unknown and plugin-owned names still
 * belong to the host fallback or their own plugin. */
export function renderOfficialToolFallback(
  owner: ToolCallOwnerProps,
  fallback: ReactNode,
): ReactNode {
  const View = OFFICIAL_TOOLVIEWS.find(
    (entry) => entry.key === owner.toolName,
  )?.component;
  return View ? <View {...owner} /> : fallback;
}
