import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@amiba/dsh-plugin-connector-core/client";
import { Webhook } from "lucide-react";
import { usePluginT } from "@amiba/ui/plugin";
import { WebhookWizard } from "./WebhookWizard.js";
import { WebhookSettings } from "./WebhookSettings.js";
import { webhookI18n } from "./i18n.js";

export const name = "amiba-connector-webhook-ui";
export const inject = ["amibaConnectorUI"];
function WebhookDetails() {
  const { t } = usePluginT(webhookI18n);
  return (
    <p className="text-sm leading-7 text-muted-foreground">
      {t("webhook.details")}
    </p>
  );
}
export async function apply(ctx: ClientContext): Promise<() => void> {
  return ctx.amibaConnectorUI.register("webhook", {
    component: WebhookWizard,
    details: WebhookDetails,
    settings: WebhookSettings,
    get tagline() {
      return document.documentElement.lang.toLowerCase().startsWith("zh")
        ? "通过 HTTP 接入自己的服务、脚本或自动化"
        : "Connect your service, script or automation over HTTP";
    },
    icon: <Webhook />,
  });
}
