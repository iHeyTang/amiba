import { useState } from "react";
import { Webhook } from "lucide-react";
import { Button, WizardFrame, usePluginT } from "@amiba/ui/plugin";
import type { ConnectWizardHost } from "@amiba/dsh-plugin-connector-core/client";
import {
  newToken,
  senderList,
  WebhookAccess,
  WebhookFields,
} from "./WebhookFields.js";
import { webhookI18n } from "./i18n.js";

export function WebhookWizard({ host }: { host: ConnectWizardHost }) {
  const { t } = usePluginT(webhookI18n);
  const [name, setName] = useState(host.prefill?.name ?? "Webhook");
  const [preset, setPreset] = useState(host.prefill?.agentPreset ?? "");
  const [outboundUrl, setOutboundUrl] = useState("");
  const [senders, setSenders] = useState("");
  const [token] = useState(newToken);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [created, setCreated] = useState<Awaited<
    ReturnType<ConnectWizardHost["adapter"]["create"]>
  > | null>(null);
  const { BasicsFields } = host.kit;
  return (
    <WizardFrame
      title={t("webhook.title")}
      subtitle={t("webhook.description")}
      icon={<Webhook />}
      onBack={host.back}
      backLabel={t("webhook.back")}
      closeLabel={t("webhook.close")}
      onClose={() => (created ? host.done(created) : host.cancel())}
      hint={t("webhook.privacy")}
      actions={
        <>
          <Button
            disabled={busy || (!created && (!name.trim() || !preset))}
            onClick={async () => {
              if (created) {
                host.done(created);
                return;
              }
              setBusy(true);
              setError(false);
              try {
                setCreated(
                  await host.adapter.create({
                    provider: host.providerId,
                    name: name.trim(),
                    agentPreset: preset,
                    config: {
                      token,
                      outboundUrl: outboundUrl.trim(),
                      allowedSenders: senderList(senders),
                    },
                  }),
                );
              } catch {
                setError(true);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t(created ? "webhook.done" : "webhook.create")}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {t("webhook.failed")}
          </p>
        ) : null}
        {created ? (
          <WebhookAccess id={created.id} token={token} />
        ) : (
          <>
            <BasicsFields
              name={name}
              onNameChange={setName}
              preset={preset}
              onPresetChange={setPreset}
              presets={host.presets}
            />
            <WebhookFields
              outboundUrl={outboundUrl}
              setOutboundUrl={setOutboundUrl}
              senders={senders}
              setSenders={setSenders}
            />
          </>
        )}
      </div>
    </WizardFrame>
  );
}
