import { useMemo } from "react";

import { WizardFrame, usePluginT } from "@amiba/ui/plugin";

import type { ConnectAdapter } from "./adapter.js";
import { connectI18n } from "./i18n.js";
import { connectWizardKit } from "./wizard-kit.js";
import type {
  ConnectWizardHost,
  ConnectorUIRegistry,
  PresetOption,
} from "./connector-ui-registry.js";
import type { ConnectView } from "../types.js";

export interface ProviderScreenProps {
  providerId: string;
  registry: ConnectorUIRegistry;
  adapter: ConnectAdapter;
  presets: PresetOption[];
  prefill?: ConnectWizardHost["prefill"];
  onBack?(): void;
  onDone(connect: ConnectView): void;
  onCancel(): void;
}

/** Hands the whole seat to one provider's wizard; core draws nothing around it. */
export function ProviderScreen({
  providerId,
  registry,
  adapter,
  presets,
  prefill,
  onBack,
  onDone,
  onCancel,
}: ProviderScreenProps) {
  const { t } = usePluginT(connectI18n);
  const entry = registry.get(providerId);
  const host = useMemo<ConnectWizardHost>(
    () => ({
      providerId,
      presets,
      adapter,
      kit: connectWizardKit,
      back: onBack,
      done: onDone,
      cancel: onCancel,
      ...(prefill ? { prefill } : {}),
    }),
    [providerId, presets, adapter, prefill, onBack, onDone, onCancel],
  );
  if (!entry) {
    return (
      <WizardFrame
        backLabel={t("options.connect.dsh.wizard.changePlatform")}
        closeLabel={t("options.connect.dsh.close")}
        onBack={onBack}
        onClose={onCancel}
        title={providerId}
      >
        <p className="text-sm text-muted-foreground">
          {t("options.connect.dsh.wizard.noWizard")}
        </p>
      </WizardFrame>
    );
  }
  const Screen = entry.component;
  return <Screen host={host} />;
}
