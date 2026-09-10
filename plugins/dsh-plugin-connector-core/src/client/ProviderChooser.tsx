import { ArrowRight, Cable } from "lucide-react";
import type { ReactNode } from "react";

import { Button, WizardFrame, usePluginT } from "@amiba/ui/plugin";

import { connectI18n } from "./i18n.js";
import { useConnectorUIProviderIds } from "./connector-ui-registry.js";
import type { ConnectorUIRegistry } from "./connector-ui-registry.js";
import type { ConnectorProviderView } from "../types.js";

export interface ProviderChooserProps {
  registry: ConnectorUIRegistry;
  providers: ConnectorProviderView[];
  title: string;
  subtitle?: string;
  hint?: ReactNode;
  onPick(providerId: string): void;
  onCancel(): void;
}

/** Core's only screen: pick a platform. Click a card to hand the whole seat to that platform's wizard. */
export function ProviderChooser({
  registry,
  providers,
  title,
  subtitle,
  hint,
  onPick,
  onCancel,
}: ProviderChooserProps) {
  const { t } = usePluginT(connectI18n);
  const registered = useConnectorUIProviderIds(registry);
  const choices = providers.filter((p) => registered.includes(p.id));
  return (
    <WizardFrame
      actions={
        <Button onClick={onCancel} size="sm" type="button" variant="outline">
          {t("options.connect.dsh.cancel")}
        </Button>
      }
      closeLabel={t("options.connect.dsh.cancel")}
      hint={hint}
      onClose={onCancel}
      subtitle={subtitle}
      title={title}
    >
      <div className="grid grid-cols-2 gap-3">
        {choices.map((p) => {
          const entry = registry.get(p.id);
          return (
            <button
              className="group relative flex min-h-[7.5rem] flex-col gap-3 rounded-xl border border-border bg-background p-4 text-left transition-colors hover:border-primary/50 hover:bg-primary/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              key={p.id}
              onClick={() => onPick(p.id)}
              type="button"
            >
              {entry?.icon ? (
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center [&>img]:h-full [&>img]:w-full"
                  data-provider-logo=""
                >
                  {entry.icon}
                </span>
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] border border-border/90 bg-muted/60 text-foreground/70 group-hover:border-primary/30 group-hover:bg-background group-hover:text-primary">
                  <Cable className="h-[18px] w-[18px]" />
                </span>
              )}
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{p.name}</span>
                {entry?.tagline ? (
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                    {entry.tagline}
                  </span>
                ) : null}
              </span>
              <ArrowRight className="absolute right-3.5 top-4 h-4 w-4 text-muted-foreground/60 group-hover:text-primary" />
            </button>
          );
        })}
      </div>
    </WizardFrame>
  );
}
