import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import {
  Dialog, DialogContent, DialogDescription, DialogTitle, usePluginT,
} from "@amiba/ui/plugin";

import type { ConnectAdapter } from "./adapter.js";
import { connectI18n } from "./i18n.js";
import { ProviderChooser } from "./ProviderChooser.js";
import { ProviderScreen } from "./ProviderScreen.js";
import type { ConnectWizardRegistry, PresetOption } from "./wizard-registry.js";
import type { ConnectorProviderView } from "../types.js";

export interface AddConnectModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  adapter: ConnectAdapter;
  registry: ConnectWizardRegistry;
  providers: ConnectorProviderView[];
  presets: PresetOption[];
  onCreated(): void;
}

/**
 * Screen 1 is core's chooser; screen 2 is the chosen platform's whole
 * wizard. The dialog draws no title of its own beyond the a11y one — every
 * other pixel belongs to whichever screen is mounted.
 */
export function AddConnectModal({
  open, onOpenChange, adapter, registry, providers, presets, onCreated,
}: AddConnectModalProps): ReactNode {
  const { t } = usePluginT(connectI18n);
  const [providerId, setProviderId] = useState("");
  useEffect(() => {
    if (!open) setProviderId("");
  }, [open]);
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className={providerId ? "max-w-[600px] p-0" : "max-w-lg p-0"}>
        <DialogTitle className="sr-only">{providerId || t("options.connect.dsh.add")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("options.connect.dsh.addDescription")}
        </DialogDescription>
        {!open ? null : providerId ? (
          <ProviderScreen
            adapter={adapter}
            onBack={() => setProviderId("")}
            onCancel={() => onOpenChange(false)}
            onDone={() => {
              onOpenChange(false);
              onCreated();
            }}
            presets={presets}
            providerId={providerId}
            registry={registry}
          />
        ) : (
          <ProviderChooser
            hint={t("options.connect.dsh.wizard.noPlatformHint")}
            onCancel={() => onOpenChange(false)}
            onPick={setProviderId}
            providers={providers}
            registry={registry}
            subtitle={t("options.connect.dsh.wizard.pickSubtitle")}
            title={t("options.connect.dsh.add")}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
