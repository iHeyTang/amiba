import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  Button, Input, Label,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  cn, usePluginT,
} from "@amiba/ui/plugin";

import type { ConnectAdapter } from "./adapter.js";
import { connectI18n } from "./i18n.js";
import { connectWizardKit } from "./wizard-kit.js";
import { useConnectWizardProviderIds } from "./wizard-registry.js";
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
  // Read through the subscription rather than `registry.get` so a wizard
  // registered (or disposed) after this chrome mounted — a provider plugin's
  // client half settles on its own schedule — shows up without a remount.
  const registeredIds = useConnectWizardProviderIds(registry);
  const choices = useMemo(
    () => providers.filter((p) => registeredIds.includes(p.id)),
    [providers, registeredIds],
  );
  // `initialProvider` seeds `provider` unconditionally — even when it has no
  // registry entry — so a pre-selected-but-unregistered provider skips the
  // picker and lands straight on the no-wizard notice below, rather than
  // silently falling back to the picker step.
  const [provider, setProvider] = useState(initialProvider ?? "");
  const [name, setName] = useState(initialName ?? "");
  // The initializer covers the synchronous case (a caller that already has the
  // list). In the real app it never fires: `DshSettingsConnect` loads presets
  // lazily once the add flow opens, so the chrome mounts with `presets === []`
  // and the list lands a tick later. Without the effect below `agentPreset`
  // would stay `""` forever and the first add would fail server-side with
  // `agent_preset_required`.
  const [agentPreset, setAgentPreset] = useState(
    initialPresetId(presets, initialPreset),
  );
  useEffect(() => {
    // Only ever fills a still-empty selection — never overwrites a preset the
    // user picked, and never re-runs once one is set.
    if (agentPreset || presets.length === 0) return;
    setAgentPreset(initialPresetId(presets, initialPreset));
  }, [presets, initialPreset, agentPreset]);

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
    presets,
    adapter,
    kit: connectWizardKit,
    back: () => setProvider(""),
    done: onDone,
    cancel: onCancel,
    connectName: name.trim(),
    agentPreset,
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
          <SelectTrigger id="dsh-connect-agent-preset">
            <SelectValue placeholder={t("options.connect.dsh.agentPreset")} />
          </SelectTrigger>
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
          // Dead end: no body means no cancel control of its own, and with
          // `initialProvider` set there is no picker step to go back to
          // either. Phase B's composer takeover has no dialog chrome to close
          // instead, so the notice carries its own way out.
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {t("options.connect.dsh.wizard.noWizard")}
            </p>
            <div className="flex justify-end">
              <Button onClick={onCancel} variant="ghost">
                {t("options.connect.dsh.cancel")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
