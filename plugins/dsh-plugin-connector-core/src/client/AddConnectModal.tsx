import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DIALOG_MOTION_MS,
  DialogTitle,
  usePluginT,
} from "@amiba/ui/plugin";

import type { ConnectAdapter } from "./adapter.js";
import { connectI18n } from "./i18n.js";
import { ProviderScreen } from "./ProviderScreen.js";
import type {
  ConnectorUIRegistry,
  PresetOption,
} from "./connector-ui-registry.js";

export interface AddConnectModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  adapter: ConnectAdapter;
  registry: ConnectorUIRegistry;
  providerId: string | null;
  presets: PresetOption[];
  onCreated(): void;
}

/**
 * Hosts the provider wizard selected from the settings-page directory. The
 * directory stays on the page, so this dialog never repeats it as a chooser.
 * It draws no title of its own beyond the a11y one — every visible pixel
 * belongs to the provider screen, including the `WizardFrame` close button;
 * `hideDefaultClose` prevents `DialogContent` from stacking a second X on it.
 */
export function AddConnectModal({
  open,
  onOpenChange,
  adapter,
  registry,
  providerId,
  presets,
  onCreated,
}: AddConnectModalProps): ReactNode {
  const { t } = usePluginT(connectI18n);
  // Preserve the provider screen through the dialog's exit transition. The
  // page clears `providerId` as soon as close begins; swapping to an empty
  // screen during those 200 ms would recreate the old closing flash.
  const [activeProviderId, setActiveProviderId] = useState(providerId ?? "");
  // Use the incoming id immediately on open instead of waiting for the
  // effect, while the remembered id keeps the same screen mounted on close.
  const visibleProviderId = providerId ?? activeProviderId;
  useEffect(() => {
    if (open && providerId) {
      setActiveProviderId(providerId);
      return;
    }
    if (open) return;
    const timer = window.setTimeout(
      () => setActiveProviderId(""),
      DIALOG_MOTION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [open, providerId]);
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-h-[calc(100vh-2rem)] overflow-y-auto p-0"
        hideDefaultClose
        size="lg"
      >
        <DialogTitle className="sr-only">
          {visibleProviderId || t("options.connect.dsh.add")}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {t("options.connect.dsh.addDescription")}
        </DialogDescription>
        {visibleProviderId ? (
          <ProviderScreen
            adapter={adapter}
            onCancel={() => onOpenChange(false)}
            onDone={() => {
              onOpenChange(false);
              onCreated();
            }}
            presets={presets}
            providerId={visibleProviderId}
            registry={registry}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
