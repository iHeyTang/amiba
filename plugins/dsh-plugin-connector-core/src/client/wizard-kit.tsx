import { useEffect, useId } from "react";

import {
  Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  cn, usePluginT,
} from "@amiba/ui/plugin";

import { connectI18n } from "./i18n.js";
import type { PresetOption } from "./wizard-registry.js";

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

export interface ConnectWizardKit {
  BasicsFields: typeof BasicsFields;
}

/** Handed to every provider wizard on `host.kit` (each plugin client is its own bundle, so parts travel on the host, not through imports). */
export const connectWizardKit: ConnectWizardKit = { BasicsFields };
