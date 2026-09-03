import type { ToolCallOwnerProps } from "@amiba/extension-sdk";
import { Cable } from "lucide-react";

import {
  ToolRowFrame,
  toolCallDurationMs,
  toolCallFailed,
  toolCallResultText,
  toolCallSettled,
  usePluginT,
} from "@amiba/ui/plugin";

import { connectI18n } from "./i18n.js";

function parseResult(
  text: string,
): { status?: string; connect?: { provider?: string; name?: string } } | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object"
      ? (value as { status?: string; connect?: { provider?: string; name?: string } })
      : null;
  } catch {
    return null;
  }
}

/**
 * The `tool.call.toolview` row for `amiba_connect_add`: waiting while the
 * user works in the conversation question seat, then a one-line outcome.
 * Composed from `@amiba/ui`'s generic `ToolRowFrame`, the same way
 * ui-shell's `AskUserQuestionToolview` is — the row stays visually
 * indistinguishable from the built-in ones.
 *
 * Reads nothing but the tool's own public result envelope; credentials never
 * touch this row because they never leave the wizard.
 */
export function ConnectAddToolview({ block }: ToolCallOwnerProps) {
  const { t } = usePluginT(connectI18n);
  const settled = toolCallSettled(block);
  const failed = toolCallFailed(block);
  const result = settled && !failed ? parseResult(toolCallResultText(block)) : null;
  const target = !settled
    ? t("options.connect.dsh.tool.waiting")
    : result?.status === "connected"
      ? t("options.connect.dsh.tool.connected", {
          provider: result.connect?.provider ?? "",
          name: result.connect?.name ?? "",
        })
      : result?.status === "cancelled"
        ? t("options.connect.dsh.tool.cancelled")
        : t("options.connect.dsh.tool.failed");
  const durationMs = toolCallDurationMs(block);
  return (
    <ToolRowFrame
      action={t("options.connect.dsh.tool.action")}
      ariaLabel={`${t("options.connect.dsh.tool.action")} ${target}`}
      {...(durationMs === undefined ? {} : { durationMs })}
      failed={failed}
      icon={Cable}
      running={!settled}
      target={target}
    />
  );
}
