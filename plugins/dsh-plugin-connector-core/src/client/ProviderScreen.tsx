import { ChevronLeft } from "lucide-react";
import { useMemo } from "react";

import { Button, WizardFrame, usePluginT } from "@amiba/ui/plugin";

import type { ConnectAdapter } from "./adapter.js";
import { connectI18n } from "./i18n.js";
import { connectWizardKit } from "./wizard-kit.js";
import type { ConnectWizardHost, ConnectWizardRegistry, PresetOption } from "./wizard-registry.js";
import type { ConnectView } from "../types.js";

export interface ProviderScreenProps {
  providerId: string;
  registry: ConnectWizardRegistry;
  adapter: ConnectAdapter;
  presets: PresetOption[];
  prefill?: ConnectWizardHost["prefill"];
  onBack(): void;
  onDone(connect: ConnectView): void;
  onCancel(): void;
}

/** Hands the whole seat to one provider's wizard; core draws nothing around it. */
export function ProviderScreen({ providerId, registry, adapter, presets, prefill, onBack, onDone, onCancel }: ProviderScreenProps) {
  const { t } = usePluginT(connectI18n);
  const entry = registry.get(providerId);
  const host = useMemo<ConnectWizardHost>(() => ({
    providerId, presets, adapter, kit: connectWizardKit, back: onBack, done: onDone, cancel: onCancel,
    ...(prefill ? { prefill } : {}),
  }), [providerId, presets, adapter, prefill, onBack, onDone, onCancel]);
  if (!entry) {
    return (
      <WizardFrame
        actions={<>
          <Button onClick={onBack} size="sm" type="button" variant="ghost"><ChevronLeft className="h-3.5 w-3.5" />{t("options.connect.dsh.wizard.changePlatform")}</Button>
          <Button onClick={onCancel} size="sm" type="button" variant="outline">{t("options.connect.dsh.cancel")}</Button>
        </>}
        closeLabel={t("options.connect.dsh.cancel")}
        onClose={onCancel}
        title={providerId}
      >
        <p className="text-sm text-muted-foreground">{t("options.connect.dsh.wizard.noWizard")}</p>
      </WizardFrame>
    );
  }
  const Screen = entry.component;
  return <Screen host={host} />;
}
