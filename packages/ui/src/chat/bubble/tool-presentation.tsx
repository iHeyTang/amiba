import type { ToolProgress } from "@amiba/app-runtime/core";
import type { TranslateFn } from "@amiba/i18n";
import { Wrench, type LucideIcon } from "lucide-react";

import {
  CodeEvidence,
  EvidenceShell,
  StructuredEvidence,
  decodeToolResult,
  oneline,
  recordOf,
  stringValue,
  toolResultText,
} from "./tool-evidence";

/**
 * The GENERIC tool-call presentation — deliberately name-free.
 *
 * This module is the fallback the conversation renders for a tool no one
 * has claimed: a quiet wrench row naming the call, expandable into the raw
 * arguments and result. EVERY named tool's presentation belongs to a
 * `tool.call.toolview` occupant registered by the tool's owner — ui-shell
 * for the official runtime tools, each Amiba plugin for its own — composed
 * from `ToolRowFrame` and the evidence components in `./tool-evidence`.
 * Adding a tool name here is the wrong move by construction.
 */

export interface ToolCallPresentation {
  action: string;
  target: string;
  icon: LucideIcon;
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

function fallbackTarget(event: ToolProgress): string {
  const label = (event.label ?? "").trim();
  if (!label || label === event.tool || label.startsWith("{")) return "";
  return oneline(label);
}

/**
 * Name-free semantic guess at the call's subject: the argument keys tools
 * conventionally put their target in, then the host-provided label, then
 * the wire tool name itself.
 */
function genericTarget(event: ToolProgress): string {
  const args = parsedArgs(event);
  const semantic = stringValue(
    args,
    "name",
    "query",
    "target",
    "path",
    "file_path",
    "url",
    "command",
    "pattern",
    "action",
  );
  return oneline(semantic || fallbackTarget(event) || event.tool);
}

export function describeToolCall(
  event: ToolProgress,
  t: TranslateFn,
): ToolCallPresentation {
  return {
    action: t("sidepanel.trace.actions.useTool"),
    target: genericTarget(event),
    icon: Wrench,
  };
}

export function hasToolDetail(event: ToolProgress): boolean {
  return Boolean(event.error) || event.result !== undefined;
}

/**
 * Generic expanded evidence: the result's text (error-toned on failure),
 * else its structure, else the call's arguments — the honest raw record.
 */
export function ToolDetail({
  event,
  t: _t,
}: {
  event: ToolProgress;
  t: TranslateFn;
}) {
  const output = toolResultText(event.result);
  const decoded = decodeToolResult(event.result);
  return (
    <EvidenceShell tag="generic">
      {output ? (
        <CodeEvidence text={output} tone={event.error ? "error" : "default"} />
      ) : (
        <StructuredEvidence value={decoded ?? parsedArgs(event)} />
      )}
    </EvidenceShell>
  );
}
