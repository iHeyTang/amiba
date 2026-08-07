import { useState } from "react";

import type {
  HermesProviderConnection,
  HermesProviderConnectionMethod,
  HermesProviderConnectionStatus,
  HermesProviderCredentialField,
  HermesProviderServiceStatus,
} from "@amiba/core";
import { useT, type MessageKey } from "@amiba/i18n";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from "../primitives";

const FIELD_LABEL_KEYS: Record<string, MessageKey> = {
  ANTHROPIC_API_KEY: "options.models.provider.method.anthropicApiKey",
  ANTHROPIC_TOKEN: "options.models.provider.method.anthropicOauth",
  CLAUDE_CODE_OAUTH_TOKEN: "options.models.provider.method.claudeSetupToken",
  COPILOT_GITHUB_TOKEN: "options.models.provider.method.copilotToken",
  GH_TOKEN: "options.models.provider.method.githubCliToken",
  GITHUB_TOKEN: "options.models.provider.method.githubToken",
};

const EXTERNAL_LABEL_KEYS: Record<string, MessageKey> = {
  claude_code: "options.models.provider.method.claudeCode",
  github_cli: "options.models.provider.method.githubCli",
  hermes_pkce: "options.models.provider.method.hermesOauth",
};

function fallbackCredentialMethodLabel(key: string): string {
  const brandedParts: Record<string, string> = {
    ANTHROPIC: "Anthropic",
    CLAUDE: "Claude",
    COPILOT: "Copilot",
    GEMINI: "Gemini",
    GITHUB: "GitHub",
    GOOGLE: "Google",
    KIMI: "Kimi",
    OPENAI: "OpenAI",
    OPENROUTER: "OpenRouter",
  };
  return key
    .split("_")
    .filter(Boolean)
    .map((part) => {
      const upper = part.toUpperCase();
      if (brandedParts[upper]) return brandedParts[upper];
      if (["AI", "API", "GH", "GLM", "OAUTH", "URL"].includes(upper)) {
        return upper === "OAUTH" ? "OAuth" : upper;
      }
      return `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`;
    })
    .join(" ");
}

export function providerConnectionMethodLabel(
  method: HermesProviderConnectionMethod | undefined,
  field: HermesProviderCredentialField | undefined,
  t: ReturnType<typeof useT>["t"],
): string {
  const key = field?.key || method?.field_key || "";
  const fieldKey = FIELD_LABEL_KEYS[key];
  if (fieldKey) return t(fieldKey);
  if (method?.label) return method.label;
  const sourceKey = EXTERNAL_LABEL_KEYS[method?.source ?? ""];
  if (sourceKey) return t(sourceKey);
  if (key) return fallbackCredentialMethodLabel(key);
  return method?.source || t("options.models.provider.connection.external");
}

function connectionStatusLabel(
  status: HermesProviderConnectionStatus,
  t: ReturnType<typeof useT>["t"],
): string {
  return t(`options.models.provider.connection.status.${status}` as MessageKey);
}

export function providerConnectionScopeLabel(
  connection: HermesProviderConnection,
  t: ReturnType<typeof useT>["t"],
): string {
  if (
    connection.status === "unavailable" ||
    connection.status === "verification_required"
  ) {
    return connectionStatusLabel(connection.status, t);
  }
  const scope = connection.active_scope ?? "none";
  return t(`options.models.provider.connection.scope.${scope}` as MessageKey);
}

function serviceStatusLabel(
  status: HermesProviderServiceStatus,
  t: ReturnType<typeof useT>["t"],
): string {
  return t(`options.models.provider.service.status.${status}` as MessageKey);
}

function copilotServiceHint(
  reason: string,
  t: ReturnType<typeof useT>["t"],
): string {
  if (reason === "unsupported_token") {
    return t("options.models.provider.service.copilotUnsupportedToken");
  }
  if (reason === "verification_failed") {
    return t("options.models.provider.service.copilotVerificationFailed");
  }
  if (reason === "copilot_access_denied" || reason === "empty_exchange") {
    return t("options.models.provider.service.copilotDenied");
  }
  return t("options.models.provider.service.copilotHint");
}

function statusClasses(status: HermesProviderConnectionStatus): string {
  if (status === "verified") {
    return "border-[hsl(var(--success))]/25 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]";
  }
  if (status === "detected") {
    return "border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]";
  }
  if (status === "verification_required") {
    return "border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]";
  }
  if (status === "unavailable") {
    return "border-destructive/25 bg-destructive/10 text-destructive";
  }
  if (status === "configured") {
    return "border-border/80 bg-muted/45 text-foreground";
  }
  return "border-border/70 bg-transparent text-muted-foreground";
}

function StatusDot({ status }: { status: HermesProviderConnectionStatus }) {
  return <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />;
}

export interface ProviderConnectionStatusBadgeProps {
  connection?: HermesProviderConnection;
  fields: HermesProviderCredentialField[];
  provider: string;
}

export function ProviderConnectionStatusBadge({
  connection,
  fields,
  provider,
}: ProviderConnectionStatusBadgeProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);

  if (!connection) return null;

  const activeMethod = connection.methods.find(
    (method) => method.id === connection.active_method,
  );
  const activeField = fields.find(
    (field) => field.key === activeMethod?.field_key,
  );
  const activeLabel = activeMethod
    ? providerConnectionMethodLabel(activeMethod, activeField, t)
    : t("options.models.provider.connection.notDetected");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-expanded={open}
          aria-haspopup="dialog"
          className={cn(
            "inline-flex h-[18px] shrink-0 items-center gap-1 rounded-full border px-1.5 text-[9px] font-normal leading-none transition-colors",
            "hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            statusClasses(connection.status),
          )}
          type="button"
        >
          <StatusDot status={connection.status} />
          {providerConnectionScopeLabel(connection, t)}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        aria-label={t("options.models.provider.connection.details")}
        data-provider-connection-details
        onOpenAutoFocus={(event) => event.preventDefault()}
        padding="md"
        role="dialog"
        side="bottom"
        size="sm"
      >
        <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-[10px] leading-4">
          <dt className="text-muted-foreground">
            {provider === "copilot"
              ? t("options.models.provider.connection.githubIdentity")
              : t("options.models.provider.connection.credentialSource")}
          </dt>
          <dd className="min-w-0 truncate font-medium" title={activeLabel}>
            {activeLabel}
          </dd>

          <dt className="text-muted-foreground">
            {t("options.models.provider.connection.scope.title")}
          </dt>
          <dd className="font-medium">
            {providerConnectionScopeLabel(connection, t)}
          </dd>

          {provider === "copilot" ? (
            <>
              <dt className="text-muted-foreground">
                {t("options.models.provider.connection.copilotService")}
              </dt>
              <dd className="font-medium">
                {serviceStatusLabel(connection.service.status, t)}
              </dd>
              {connection.service.status !== "verified" ? (
                <>
                  <dt className="text-muted-foreground">
                    {t("options.models.provider.connection.reason")}
                  </dt>
                  <dd className="text-muted-foreground">
                    {copilotServiceHint(connection.service.reason, t)}
                  </dd>
                </>
              ) : null}
            </>
          ) : (
            <>
              <dt className="text-muted-foreground">
                {t("options.models.provider.connection.title")}
              </dt>
              <dd className="flex items-center gap-1.5 font-medium">
                <span className={statusClasses(connection.status)}>
                  <StatusDot status={connection.status} />
                </span>
                {connectionStatusLabel(connection.status, t)}
              </dd>
            </>
          )}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
