import type { ToolCallOwnerProps } from "@amiba/extension-sdk";
import {
  SemanticToolRow,
  CodeEvidence,
  StructuredEvidence,
  decodeToolResult,
  oneline,
  stringValue,
  usePluginT,
  type SemanticEvidenceContext,
  type SemanticToolSpec,
} from "@amiba/ui/plugin";
import { FileText, ListTodo, Users } from "lucide-react";

const copy = {
  "zh-CN": {
    steward_list_tasks: "查看任务列表",
    steward_dispatch: "分派任务",
    steward_adopt: "接管任务",
    steward_read_task: "读取任务进展",
    steward_close_task: "关闭任务",
  },
  en: {
    steward_list_tasks: "List tasks",
    steward_dispatch: "Dispatch task",
    steward_adopt: "Adopt task",
    steward_read_task: "Read task progress",
    steward_close_task: "Close task",
  },
};
function resultEvidence(ctx: SemanticEvidenceContext) {
  const value = decodeToolResult(ctx.text);
  return typeof value === "string" ? (
    value ? (
      <CodeEvidence text={value} />
    ) : null
  ) : (
    <StructuredEvidence value={value} />
  );
}

const specs: Record<string, SemanticToolSpec> = {
  steward_list_tasks: {
    icon: ListTodo,
    action: "steward_list_tasks",
    evidence: resultEvidence,
  },
  steward_dispatch: {
    icon: Users,
    action: "steward_dispatch",
    target: (args) => oneline(stringValue(args, "new_task_title", "task_id")),
    evidence: resultEvidence,
  },
  steward_adopt: {
    icon: Users,
    action: "steward_adopt",
    target: (args) => oneline(stringValue(args, "task_id", "session_id")),
    evidence: resultEvidence,
  },
  steward_read_task: {
    icon: FileText,
    action: "steward_read_task",
    target: (args) => oneline(stringValue(args, "task_id")),
    evidence: resultEvidence,
  },
  steward_close_task: {
    icon: ListTodo,
    action: "steward_close_task",
    target: (args) => oneline(stringValue(args, "task_id")),
    evidence: resultEvidence,
  },
};

export const TOOLVIEWS = Object.entries(specs).map(([key, spec]) => ({
  key,
  component: function Toolview(owner: ToolCallOwnerProps) {
    const { t } = usePluginT(copy);
    return <SemanticToolRow owner={owner} spec={spec} tag={key} t={t} />;
  },
}));
