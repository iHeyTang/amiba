import type { ReactNode } from "react";

import {
  Dialog, DialogContent, DialogDescription, DialogTitle, usePluginT,
} from "@amiba/ui/plugin";

import type { ConnectAdapter } from "./adapter.js";
import { ConnectWizardChrome } from "./ConnectWizardChrome.js";
import { connectI18n } from "./i18n.js";
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
 * Modal chrome around `ConnectWizardChrome`: owns the Dialog frame (title +
 * description via connector-core's own `connectI18n` overlay) and the two
 * lifecycle edges the wizard itself doesn't know about — closing the dialog
 * on cancel, and closing it + notifying the caller on a completed create.
 * `DshSettingsConnect` mounts this in place of the retired
 * `CreateConnectDialog` (Task 5 deletes that dialog's code).
 */
export function AddConnectModal({
  open, onOpenChange, adapter, registry, providers, presets, onCreated,
}: AddConnectModalProps): ReactNode {
  const { t } = usePluginT(connectI18n);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{t("options.connect.dsh.add")}</DialogTitle>
        <DialogDescription>{t("options.connect.dsh.addDescription")}</DialogDescription>
        <div className="pt-2">
          {open ? (
            <ConnectWizardChrome
              adapter={adapter}
              registry={registry}
              providers={providers}
              presets={presets}
              onCancel={() => onOpenChange(false)}
              onDone={() => {
                onOpenChange(false);
                onCreated();
              }}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
