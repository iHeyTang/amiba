import {
  CodeEvidence,
  EvidenceShell,
  ToolRowFrame,
  oneline,
  stringValue,
  toolCallArgs,
  toolCallDurationMs,
  toolCallFailed,
  toolCallResultText,
  toolCallSettled,
  usePluginT,
} from "@amiba/ui/plugin";
import { Brain } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The memory plugin's own `tool.call.toolview` occupants: the plugin that
 * registers `memory_store`/`memory_list`/`memory_forget` also owns their
 * timeline rows.
 */

type MemoryBlock = Parameters<typeof toolCallArgs>[0];

function actionLabel(language: string): string {
  return language.toLowerCase().startsWith("zh")
    ? "维护记忆"
    : "Update memory";
}

function MemoryToolRow({ block }: { block: MemoryBlock }): ReactNode {
  const { language } = usePluginT();
  const args = toolCallArgs(block);
  const failed = toolCallFailed(block);
  const running = toolCallSettled(block) === null;
  const text = toolCallResultText(block);
  const durationMs = toolCallDurationMs(block);
  const target = oneline(
    stringValue(args, "content", "target", "query", "id"),
    60,
  );
  const body = failed ? (
    <CodeEvidence text={text} tone="error" />
  ) : !running && text ? (
    <CodeEvidence text={text} />
  ) : null;
  return (
    <ToolRowFrame
      icon={Brain}
      action={actionLabel(language)}
      target={target || undefined}
      {...(durationMs === undefined ? {} : { durationMs })}
      running={running}
      failed={failed}
      detail={
        body ? <EvidenceShell tag="memory">{body}</EvidenceShell> : undefined
      }
    />
  );
}

export const MEMORY_TOOLVIEW_KEYS = [
  "memory_store",
  "memory_list",
  "memory_forget",
] as const;

export function MemoryToolview(props: { block: MemoryBlock }): ReactNode {
  return <MemoryToolRow block={props.block} />;
}
