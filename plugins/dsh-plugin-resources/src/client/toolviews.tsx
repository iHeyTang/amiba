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
import { FileText, Search } from "lucide-react";

const copy = {
  "zh-CN": {
    amiba_resource_search: "搜索已连接资源",
    amiba_resource_read: "读取已连接资源",
  },
  en: {
    amiba_resource_search: "Search connected resources",
    amiba_resource_read: "Read connected resource",
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
  amiba_resource_search: {
    icon: Search,
    action: "amiba_resource_search",
    target: (args) => oneline(stringValue(args, "query")),
    evidence: resultEvidence,
  },
  amiba_resource_read: {
    icon: FileText,
    action: "amiba_resource_read",
    target: (args) => oneline(stringValue(args, "reference")),
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
