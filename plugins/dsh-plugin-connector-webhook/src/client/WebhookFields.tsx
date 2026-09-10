import { useEffect, useId, useState } from "react";
import { Check, Copy } from "lucide-react";
import {
  Button,
  Input,
  Label,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  usePluginT,
} from "@amiba/ui/plugin";
import { webhookI18n } from "./i18n.js";

export function newToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function endpoint(id: string): string {
  const base =
    document.documentElement.getAttribute("data-amiba-dsh-base-url") ??
    window.location.origin;
  return new URL(
    `/api/amiba/connectors/webhook/${encodeURIComponent(id)}`,
    base,
  ).toString();
}

export function WebhookFields({
  outboundUrl,
  setOutboundUrl,
  senders,
  setSenders,
}: {
  outboundUrl: string;
  setOutboundUrl(value: string): void;
  senders: string;
  setSenders(value: string): void;
}) {
  const { t } = usePluginT(webhookI18n);
  const id = useId();
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor={`${id}-url`}>{t("webhook.callback")}</Label>
        <Input
          id={`${id}-url`}
          type="url"
          placeholder="https://…"
          value={outboundUrl}
          onChange={(event) => setOutboundUrl(event.target.value)}
        />
        <p className="text-sm leading-5 text-muted-foreground">
          {t("webhook.callbackHint")}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-senders`}>{t("webhook.senders")}</Label>
        <Input
          id={`${id}-senders`}
          value={senders}
          onChange={(event) => setSenders(event.target.value)}
        />
        <p className="text-sm leading-5 text-muted-foreground">
          {t("webhook.sendersHint")}
        </p>
      </div>
    </div>
  );
}

export const senderList = (value: string) => [
  ...new Set(
    value
      .split(/[,，\n]/u)
      .map((id) => id.trim())
      .filter(Boolean),
  ),
];

export function CopyValue({ label, value }: { label: string; value: string }) {
  const { t } = usePluginT(webhookI18n);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    setCopied(false);
    setError(false);
  }, [value]);
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex items-center gap-2 rounded-lg bg-muted/40 p-3">
        <code className="min-w-0 flex-1 select-all break-all text-xs leading-5">
          {value}
        </code>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`${t("webhook.copy")} ${label}`}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(value);
                    setCopied(true);
                    setError(false);
                  } catch {
                    setError(true);
                  }
                }}
              >
                {copied ? <Check /> : <Copy />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t(copied ? "webhook.copied" : "webhook.copy")}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t("webhook.failed")}
        </p>
      ) : null}
    </div>
  );
}

export function WebhookAccess({ id, token }: { id: string; token?: string }) {
  const { t } = usePluginT(webhookI18n);
  return (
    <section className="space-y-5">
      <CopyValue label={t("webhook.endpoint")} value={endpoint(id)} />
      {token ? (
        <>
          <CopyValue label={t("webhook.token")} value={token} />
          <p className="text-sm text-muted-foreground">{t("webhook.once")}</p>
        </>
      ) : null}
      <details className="text-sm">
        <summary className="cursor-pointer py-2 font-medium">
          {t("webhook.example")}
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-muted/40 p-4 text-xs leading-6">{`POST ${endpoint(id)}\nAuthorization: Bearer <TOKEN>\nContent-Type: application/json\n\n${JSON.stringify({ id: "event-001", text: "Hello", sender: "my-service", conversation: "thread-001" }, null, 2)}`}</pre>
      </details>
      <p className="text-sm leading-6 text-muted-foreground">
        {t("webhook.local")}
      </p>
    </section>
  );
}
