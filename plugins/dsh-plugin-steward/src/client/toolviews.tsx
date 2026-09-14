import type { ToolCallOwnerProps } from "@amiba/extension-sdk";
import {
  Button,
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
    steward_create: "创建管家",
    steward_instances: "查看管家",
    steward_update: "修改管家",
    steward_delete: "删除管家",
    steward_remember: "保存管家上下文",
    steward_list_tasks: "查看任务列表",
    steward_dispatch: "分派任务",
    steward_adopt: "接管任务",
    steward_read_task: "读取任务进展",
    steward_close_task: "关闭任务",
  },
  en: {
    steward_create: "Create steward",
    steward_instances: "List stewards",
    steward_update: "Update steward",
    steward_delete: "Delete steward",
    steward_remember: "Save steward context",
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

function createdEvidence(ctx: SemanticEvidenceContext) {
  const value = decodeToolResult(ctx.text) as {
    entryId?: string;
    name?: string;
  } | null;
  if (!value || typeof value.entryId !== "string") return resultEvidence(ctx);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent("amiba:open-steward", {
            detail: { id: value.entryId },
          }),
        )
      }
    >
      {document.documentElement.lang.startsWith("zh") ? "进入 " : "Open "}
      {value.name}
    </Button>
  );
}
const specs: Record<string, SemanticToolSpec> = {
  steward_create: {
    icon: Users,
    action: "steward_create",
    target: (args) => oneline(stringValue(args, "name")),
    evidence: createdEvidence,
  },
  steward_instances: {
    icon: Users,
    action: "steward_instances",
    evidence: resultEvidence,
  },
  steward_update: {
    icon: Users,
    action: "steward_update",
    target: (args) => oneline(stringValue(args, "name")),
    evidence: resultEvidence,
  },
  steward_delete: {
    icon: Users,
    action: "steward_delete",
    evidence: resultEvidence,
  },
  steward_remember: {
    icon: FileText,
    action: "steward_remember",
    evidence: resultEvidence,
  },
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
