import type { ReactNode } from "react";
import type { JobDetail } from "../remote.js";

/** Read's text envelope is a tool protocol, never HTML. Only unwrap a complete envelope. */
export function filePreview(output: string) {
  const match = /^\s*<path>([^\n]+)<\/path>\s*<type>(file|directory)<\/type>\s*<content>\s*\n?([\s\S]*?)<\/content>\s*$/.exec(output);
  if (!match) return undefined;
  return { path: match[1]!, kind: match[2]!, text: match[3]!.replace(/^\d+: ?/gm, "").trimEnd() };
}
export function JobResult({ detail, renderMarkdown }: { detail: JobDetail; renderMarkdown: (text: string) => ReactNode }) {
  if (!detail.output.trim()) return <p className="amiba-jobs-result-empty">暂未产生可预览的结果。</p>;
  const file = (!detail.toolName || detail.toolName === "read") ? filePreview(detail.output) : undefined;
  if (file) return <div className="amiba-jobs-result">
    <div className="amiba-jobs-file" title={file.path}>{file.path.split(/[\\/]/).pop()}</div>
    {file.kind === "file" && /\.(md|markdown)$/i.test(file.path)
      ? <div className="amiba-jobs-prose">{renderMarkdown(file.text)}</div>
      : <pre>{file.text}</pre>}
  </div>;
  if (detail.toolName && /^(bash|pwsh|pty-send)$/.test(detail.toolName)) return <pre className="amiba-jobs-terminal">{detail.output}</pre>;
  return <div className="amiba-jobs-prose">{renderMarkdown(detail.output)}</div>;
}
