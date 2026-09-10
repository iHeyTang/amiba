import { useState } from "react";
import { Button, usePluginT } from "@amiba/ui/plugin";
import type { ConnectSettingsHost } from "@amiba/dsh-plugin-connector-core/client";
import {
  newToken,
  senderList,
  WebhookAccess,
  WebhookFields,
} from "./WebhookFields.js";
import { webhookI18n } from "./i18n.js";

export function WebhookSettings({ host }: { host: ConnectSettingsHost }) {
  const { t } = usePluginT(webhookI18n);
  const [outboundUrl, setOutboundUrl] = useState(
    String(host.settings.outboundUrl ?? ""),
  );
  const [senders, setSenders] = useState(
    ((host.settings.allowedSenders as string[]) ?? []).join(", "),
  );
  const [token, setToken] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function save(patch: Record<string, unknown>, issuedToken?: string) {
    setBusy(true);
    setError(false);
    try {
      await host.save(patch);
      if (issuedToken) setToken(issuedToken);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-7">
      <WebhookAccess id={host.connect.id} token={token} />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t("webhook.failed")}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            const value = newToken();
            void save({ token: value }, value);
          }}
        >
          {t("webhook.rotate")}
        </Button>
        <p className="text-sm text-muted-foreground">
          {t("webhook.rotateHint")}
        </p>
      </div>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save({
            outboundUrl: outboundUrl.trim(),
            allowedSenders: senderList(senders),
          });
        }}
      >
        <WebhookFields
          outboundUrl={outboundUrl}
          setOutboundUrl={setOutboundUrl}
          senders={senders}
          setSenders={setSenders}
        />
        <div className="flex justify-end">
          <Button disabled={busy} type="submit">
            {t("webhook.save")}
          </Button>
        </div>
      </form>
    </div>
  );
}
