import { useEffect, useId } from "react";

import {
  Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  cn, usePluginT,
} from "@amiba/ui/plugin";

import { connectI18n } from "./i18n.js";
import type { PresetOption } from "./wizard-registry.js";
import type { MessageChannelApproval } from "../types.js";

/** prefill → the preset flagged default → the first one → "". */
export function defaultPresetId(presets: PresetOption[], prefill?: string): string {
  if (prefill && presets.some((p) => p.id === prefill)) return prefill;
  return presets.find((p) => p.isDefault)?.id ?? presets[0]?.id ?? "";
}

export interface BasicsFieldsProps {
  name: string;
  onNameChange(value: string): void;
  preset: string;
  onPresetChange(value: string): void;
  presets: PresetOption[];
  className?: string;
}

/**
 * Connect name + agent-preset picker, the two fields every connect needs. A
 * PART a provider wizard places wherever its own screen wants it — never a
 * frame around the wizard. Presets arrive asynchronously in both hosts, so
 * the picker fills an empty selection with the default once the list lands,
 * and never overwrites a value the list actually carries. A prefilled id the
 * list does NOT carry (a stale suggestion from the chat tool, a renamed or
 * deleted preset) is replaced by the default instead of being left to look
 * chosen while the Select shows its placeholder — healing it here means every
 * wizard and both hosts get the fix for free.
 */
export function BasicsFields({
  name, onNameChange, preset, onPresetChange, presets, className,
}: BasicsFieldsProps) {
  const { t } = usePluginT(connectI18n);
  const nameId = useId();
  const presetId = useId();
  useEffect(() => {
    // Fill an empty selection, and REPLACE one that is not in the list (a
    // stale prefill from the chat tool) — both only once presets have landed.
    if (presets.length === 0) return;
    if (preset && presets.some((p) => p.id === preset)) return;
    onPresetChange(defaultPresetId(presets, preset || undefined));
  }, [preset, presets, onPresetChange]);
  return (
    <div className={cn("grid grid-cols-2 gap-4", className)}>
      <div className="space-y-1.5">
        <Label htmlFor={nameId}>{t("options.connect.dsh.name")}</Label>
        <Input id={nameId} onChange={(event) => onNameChange(event.target.value)} value={name} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={presetId}>{t("options.connect.dsh.agentPreset")}</Label>
        <Select onValueChange={onPresetChange} value={preset}>
          <SelectTrigger id={presetId}>
            <SelectValue placeholder={t("options.connect.dsh.agentPreset")} />
          </SelectTrigger>
          <SelectContent>
            {presets.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/** `timeout` mode's floor, mirroring messaging-core's `MIN_APPROVAL_TIMEOUT_MS`
 * (10s) — expressed here in whole minutes since that's the unit the field
 * edits. A value below this never reaches `createConnect`: the field itself
 * refuses to emit one. */
const MIN_APPROVAL_TIMEOUT_MINUTES = 1;

/** The wizard's own default before a user touches the field: `timeout`,
 * 10 minutes — the same default messaging-core applies when a channel's
 * `approval` is absent entirely (see `DEFAULT_CHANNEL_APPROVAL`). A provider
 * wizard seeds its local state with this and only sends `approval` to
 * `createConnect` if it wants to; omitting it lets messaging-core's own
 * default apply just the same. */
export function defaultApproval(): MessageChannelApproval {
  return { mode: "timeout", timeoutMs: 10 * 60_000 };
}

function minutesFromApproval(approval: MessageChannelApproval): number {
  return Math.max(
    MIN_APPROVAL_TIMEOUT_MINUTES,
    Math.round(approval.timeoutMs / 60_000),
  );
}

export interface ApprovalFieldProps {
  approval: MessageChannelApproval;
  onApprovalChange(value: MessageChannelApproval): void;
  className?: string;
}

/**
 * The connect's approval-wait setting: `timeout` (with an editable minute
 * count, floored at 1) or `wait` forever. A PART like `BasicsFields` — a
 * provider wizard places it wherever its own form wants it and owns the
 * `approval` state itself, seeding it from `defaultApproval()`.
 *
 * The minutes input stays mounted (disabled, not unmounted) while `wait` is
 * selected, so a value the user already typed survives switching back to
 * `timeout` instead of resetting to the default.
 */
export function ApprovalField({
  approval, onApprovalChange, className,
}: ApprovalFieldProps) {
  const { t } = usePluginT(connectI18n);
  const groupName = useId();
  const minutesId = useId();
  const isTimeout = approval.mode === "timeout";
  const minutes = minutesFromApproval(approval);

  function selectTimeout() {
    if (isTimeout) return;
    onApprovalChange({ mode: "timeout", timeoutMs: minutes * 60_000 });
  }

  function selectWait() {
    if (!isTimeout) return;
    onApprovalChange({ mode: "wait", timeoutMs: approval.timeoutMs });
  }

  function changeMinutes(value: string) {
    const parsed = Number.parseInt(value, 10);
    const next =
      Number.isFinite(parsed) && parsed >= MIN_APPROVAL_TIMEOUT_MINUTES
        ? parsed
        : MIN_APPROVAL_TIMEOUT_MINUTES;
    onApprovalChange({ mode: "timeout", timeoutMs: next * 60_000 });
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label>{t("options.connect.dsh.approval.label")}</Label>
      <div
        aria-label={t("options.connect.dsh.approval.label")}
        className="space-y-2"
        role="radiogroup"
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            checked={isTimeout}
            className="h-4 w-4 accent-primary"
            name={groupName}
            onChange={selectTimeout}
            type="radio"
            value="timeout"
          />
          {t("options.connect.dsh.approval.timeout")}
          <Input
            aria-label={t("options.connect.dsh.approval.minutesLabel")}
            className="h-8 w-16 px-2"
            disabled={!isTimeout}
            id={minutesId}
            min={MIN_APPROVAL_TIMEOUT_MINUTES}
            onChange={(event) => changeMinutes(event.target.value)}
            type="number"
            value={minutes}
          />
          {t("options.connect.dsh.approval.minutes")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            checked={!isTimeout}
            className="h-4 w-4 accent-primary"
            name={groupName}
            onChange={selectWait}
            type="radio"
            value="wait"
          />
          {t("options.connect.dsh.approval.wait")}
        </label>
      </div>
    </div>
  );
}

export interface ConnectWizardKit {
  BasicsFields: typeof BasicsFields;
  ApprovalField: typeof ApprovalField;
}

/** Handed to every provider wizard on `host.kit` (each plugin client is its own bundle, so parts travel on the host, not through imports). */
export const connectWizardKit: ConnectWizardKit = { BasicsFields, ApprovalField };
