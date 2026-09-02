import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  Button, Input, Label,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  cn, usePluginT,
} from "@amiba/ui/plugin";

import type { ConnectAdapter } from "./adapter.js";
import { connectI18n } from "./i18n.js";
import type {
  ConnectWizardHost, ConnectWizardRegistry, PresetOption,
} from "./wizard-registry.js";
import type { ConnectorProviderView, ConnectView } from "../types.js";

function useT() {
  return usePluginT(connectI18n);
}

export interface ConnectWizardChromeProps {
  adapter: ConnectAdapter;
  registry: ConnectWizardRegistry;
  providers: ConnectorProviderView[];
  presets: PresetOption[];
  initialProvider?: string;
  initialName?: string;
  initialPreset?: string;
  onDone(connect: ConnectView): void;
  onCancel(): void;
}

function initialPresetId(presets: PresetOption[], prefill?: string): string {
  if (prefill && presets.some((p) => p.id === prefill)) return prefill;
  return presets.find((p) => p.isDefault)?.id ?? presets[0]?.id ?? "";
}

export function ConnectWizardChrome({
  adapter, registry, providers, presets,
  initialProvider, initialName, initialPreset, onDone, onCancel,
}: ConnectWizardChromeProps): ReactNode {
  const { t } = useT();
  // Providers offered = those with a registered wizard, joined for display.
  const choices = useMemo(
    () => providers.filter((p) => registry.get(p.id) !== undefined),
    [providers, registry],
  );
  // `initialProvider` seeds `provider` unconditionally — even when it has no
  // registry entry — so a pre-selected-but-unregistered provider skips the
  // picker and lands straight on the no-wizard notice below, rather than
  // silently falling back to the picker step.
  const [provider, setProvider] = useState(initialProvider ?? "");
  const [name, setName] = useState(initialName ?? "");
  const [agentPreset, setAgentPreset] = useState(
    initialPresetId(presets, initialPreset),
  );

  const entry = provider ? registry.get(provider) : undefined;

  if (!provider) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium">{t("options.connect.dsh.wizard.pickProvider")}</p>
        <div className="grid grid-cols-2 gap-2">
          {choices.map((p) => {
            const info = registry.get(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setProvider(p.id)}
                className="flex items-start gap-3 rounded-xl border border-border/60 bg-background p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/30"
              >
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted/30 text-muted-foreground">
                  {info?.icon ?? null}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{p.name}</span>
                  {info?.tagline ? (
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">{info.tagline}</span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex justify-end">
          <Button onClick={onCancel} variant="ghost">{t("options.connect.dsh.cancel")}</Button>
        </div>
      </div>
    );
  }

  const host: ConnectWizardHost = {
    providerId: provider,
    connectName: name.trim(),
    agentPreset,
    adapter,
    done: onDone,
    cancel: onCancel,
  };

  const Body = entry?.component;

  return (
    <div className="space-y-4">
      {!initialProvider ? (
        <button
          type="button"
          onClick={() => setProvider("")}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← {t("options.connect.dsh.wizard.back")}
        </button>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="dsh-connect-name">{t("options.connect.dsh.name")}</Label>
        <Input id="dsh-connect-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="dsh-connect-agent-preset">{t("options.connect.dsh.agentPreset")}</Label>
        <Select value={agentPreset} onValueChange={setAgentPreset}>
          <SelectTrigger id="dsh-connect-agent-preset"><SelectValue /></SelectTrigger>
          <SelectContent>
            {presets.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className={cn("rounded-xl border border-border/55 p-3")}>
        {Body ? (
          <Body host={host} />
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("options.connect.dsh.wizard.noWizard")}
          </p>
        )}
      </div>
    </div>
  );
}
