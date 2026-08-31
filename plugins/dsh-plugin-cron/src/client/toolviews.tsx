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
import { CalendarClock } from "lucide-react";
import type { ReactNode } from "react";

import { cronI18n } from "./i18n.js";

/**
 * The cron plugin's own `tool.call.toolview` occupants — the plugin that
 * registers `cron_create`/`cron_list`/`cron_delete` also owns how their
 * calls read in the timeline, composed from @amiba/ui's generic row and
 * evidence blocks like every other occupant.
 */

type CronBlock = Parameters<typeof toolCallArgs>[0];

function CronToolRow({ block }: { block: CronBlock }): ReactNode {
  const { t } = usePluginT(cronI18n);
  const args = toolCallArgs(block);
  const failed = toolCallFailed(block);
  const running = toolCallSettled(block) === null;
  const text = toolCallResultText(block);
  const durationMs = toolCallDurationMs(block);
  const target = oneline(stringValue(args, "name", "id"), 60);
  const body = failed ? (
    <CodeEvidence text={text} tone="error" />
  ) : !running && text ? (
    <CodeEvidence text={text} />
  ) : null;
  return (
    <ToolRowFrame
      icon={CalendarClock}
      action={t("cron.tool.action")}
      target={target || undefined}
      {...(durationMs === undefined ? {} : { durationMs })}
      running={running}
      failed={failed}
      detail={body ? <EvidenceShell tag="cron">{body}</EvidenceShell> : undefined}
    />
  );
}

export const CRON_TOOLVIEW_KEYS = [
  "cron_create",
  "cron_list",
  "cron_delete",
] as const;

export function CronToolview(props: { block: CronBlock }): ReactNode {
  return <CronToolRow block={props.block} />;
}
