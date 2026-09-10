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
import { FileText } from "lucide-react";

const copy = {
  "zh-CN": {
    attachment_read_text: "读取文本附件",
    attachment_read_pdf: "读取 PDF 附件",
  },
  en: {
    attachment_read_text: "Read text attachment",
    attachment_read_pdf: "Read PDF attachment",
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
  attachment_read_text: {
    icon: FileText,
    action: "attachment_read_text",
    target: (args) => oneline(stringValue(args, "attachmentId")),
    evidence: resultEvidence,
  },
  attachment_read_pdf: {
    icon: FileText,
    action: "attachment_read_pdf",
    target: (args) => oneline(stringValue(args, "attachmentId")),
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
