import { useNestedToolCalls, useNestedToolExpansion } from "./nested-tool-calls";
import { useToolImageEvidence } from "./tool-image-evidence";
import type { ToolCallOwnerProps } from "@amiba/extension-sdk";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  CodeEvidence,
  EvidenceShell,
  unwrapUntrustedToolResult,
} from "./tool-evidence";
import {
  toolCallArgs,
  toolCallDurationMs,
  toolCallFailed,
  toolCallResultText,
  toolCallSettled,
  toolCallStartedAt,
} from "./tool-call-block";
import { ToolRowFrame } from "./tool-row-frame";

export interface SemanticEvidenceContext {
  args: Record<string, unknown>;
  text: string;
  block: ToolCallOwnerProps["block"];
}
export interface SemanticToolSpec<Key extends string = string> {
  icon: LucideIcon;
  action: Key | ((args: Record<string, unknown>) => Key);
  target?: (args: Record<string, unknown>) => string;
  evidence?: (ctx: SemanticEvidenceContext) => ReactNode | null;
  quietSuccess?: boolean;
}

export function SemanticToolRow<Key extends string>({
  spec,
  tag,
  owner,
  t,
}: {
  spec: SemanticToolSpec<Key>;
  t: (key: Key) => string;
  tag: string;
  owner: ToolCallOwnerProps;
}) {
  const { block } = owner;
  const nested = useNestedToolCalls(owner);
  const expansion = useNestedToolExpansion(block);
  const images = useToolImageEvidence(owner.callId, block);
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
  const action = t(
    typeof spec.action === "function" ? spec.action(args) : spec.action,
  );
  const target = spec.target?.(args) ?? "";

  const body = failed ? (
    <CodeEvidence
      text={text || toolCallSettled(block)?.error?.code || action}
      tone="error"
    />
  ) : running || spec.quietSuccess ? null : (
    (spec.evidence?.({ args, text, block }) ?? null)
  );
  const detail = body || images || nested ? (
    <EvidenceShell tag={tag}>{body}{images}{nested}</EvidenceShell>
  ) : undefined;

  return (
    <ToolRowFrame
      {...expansion}
      presentation={owner.presentation}
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
