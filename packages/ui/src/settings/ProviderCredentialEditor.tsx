import {
  CircleDashed,
  Eye,
  EyeOff,
  Github,
  KeyRound,
  TerminalSquare,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  HermesProviderConnection,
  HermesProviderConnectionMethod,
  HermesProviderCredentialField,
} from "@amiba/core";
import { useT, type MessageKey } from "@amiba/i18n";

import {
  Button,
  cn,
  Input,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../primitives";
import { providerConnectionMethodLabel } from "./ProviderConnectionStatusBadge";

export interface ProviderCredentialEditorProps {
  authHint: string;
  authType?: string;
  connection?: HermesProviderConnection;
  error: string | null;
  fields: HermesProviderCredentialField[];
  loading: boolean;
  onChange: (key: string, value: string) => void;
  onSave: (activeCredentialKey?: string) => void;
  provider: string;
  saved: boolean;
  saving: boolean;
  values: Record<string, string>;
}

const AUTH_HINT_KEYS: Record<string, MessageKey> = {
  aws_sdk: "options.models.provider.authHint.awsSdk",
  copilot: "options.models.provider.authHint.copilot",
  external_process: "options.models.provider.authHint.externalProcess",
  oauth_device_code: "options.models.provider.authHint.oauthDevice",
  oauth_external: "options.models.provider.authHint.oauthExternal",
  oauth_minimax: "options.models.provider.authHint.oauthExternal",
  vertex: "options.models.provider.authHint.vertex",
};

function isConfigured(field: HermesProviderCredentialField): boolean {
  return field.configured ?? Boolean(field.value.trim());
}

function MethodIcon({ method }: { method?: HermesProviderConnectionMethod }) {
  if (method?.source === "github_cli") {
    return <Github aria-hidden className="h-3.5 w-3.5" />;
  }
  if (method?.kind === "external_cli" || method?.kind === "external") {
    return <TerminalSquare aria-hidden className="h-3.5 w-3.5" />;
  }
  return <KeyRound aria-hidden className="h-3.5 w-3.5" />;
}

function CredentialField({
  field,
  onChange,
  value,
}: {
  field: HermesProviderCredentialField;
  onChange: (key: string, value: string) => void;
  value: string;
}) {
  const { t } = useT();
  const secret = field.kind === "secret";
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="space-y-1.5">
      <Label
        className="flex min-w-0 items-baseline justify-between gap-3"
        htmlFor={`credential-${field.key}`}
      >
        <span className="text-xs text-foreground">
          {t(
            secret
              ? "options.models.provider.credentialValue"
              : "options.models.provider.customEndpoint",
          )}
        </span>
        <span className="min-w-0 truncate font-mono text-[9px] font-normal text-muted-foreground/70">
          {field.key}
        </span>
      </Label>
      <div className="relative">
        <Input
          autoComplete="off"
          className={cn("h-8 font-mono text-xs", secret && "pr-9")}
          id={`credential-${field.key}`}
          onChange={(event) => onChange(field.key, event.target.value)}
          placeholder={
            field.placeholder ||
            (secret
              ? t("options.models.provider.credentialPlaceholder")
              : undefined)
          }
          spellCheck={false}
          type={secret && !revealed ? "password" : secret ? "text" : "url"}
          value={value}
        />
        {secret && value ? (
          <button
            aria-label={t(
              revealed
                ? "options.models.provider.hideCredential"
                : "options.models.provider.showCredential",
            )}
            className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
            onClick={() => setRevealed((current) => !current)}
            type="button"
          >
            {revealed ? (
              <EyeOff aria-hidden className="h-3.5 w-3.5" />
            ) : (
              <Eye aria-hidden className="h-3.5 w-3.5" />
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ProviderCredentialEditor({
  authHint,
  authType,
  connection,
  error,
  fields,
  loading,
  onChange,
  onSave,
  provider,
  saved,
  saving,
  values,
}: ProviderCredentialEditorProps) {
  const { t } = useT();
  const localizedAuthHint = authType
    ? AUTH_HINT_KEYS[authType.trim().toLowerCase()]
    : undefined;
  const secretFields = useMemo(
    () => fields.filter((field) => field.kind === "secret"),
    [fields],
  );
  const sharedFields = useMemo(
    () => fields.filter((field) => field.kind !== "secret"),
    [fields],
  );
  const secretFieldKey = secretFields.map((field) => field.key).join("\u0000");
  const activeFieldKey = connection?.active_method.startsWith("env:")
    ? connection.active_method.slice(4)
    : "";
  const resolvedCredential =
    secretFields.find((field) => field.key === activeFieldKey) ??
    secretFields.find(isConfigured) ??
    null;
  const [selectedCredential, setSelectedCredential] = useState("");

  useEffect(() => {
    setSelectedCredential(
      resolvedCredential?.key ?? secretFields[0]?.key ?? "",
    );
    // Reset only when the provider/schema changes. Draft edits must not pull
    // the user back to the currently effective method.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, secretFieldKey]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <CircleDashed aria-hidden className="h-4 w-4 animate-spin" />
        {t("options.models.provider.loadingCredentials")}
      </div>
    );
  }

  if (
    fields.length === 0 &&
    !connection &&
    !localizedAuthHint &&
    !authHint &&
    !error
  ) {
    return null;
  }

  const multipleMethods = secretFields.length > 1;
  const selectedField =
    secretFields.find((field) => field.key === selectedCredential) ??
    secretFields[0];
  const discoveredMethods =
    connection?.methods.filter(
      (method) =>
        !method.editable &&
        method.detected &&
        method.id !== connection.active_method,
    ) ?? [];

  return (
    <section className="space-y-3" data-provider-credential-editor>
      {error ? (
        <p className="text-[11px] text-amber-600 dark:text-amber-500">
          {error}
        </p>
      ) : null}

      {secretFields.length > 0 ? (
        <div>
          {multipleMethods ? (
            <Tabs
              onValueChange={setSelectedCredential}
              value={selectedField?.key ?? ""}
            >
              <TabsList className="inline-flex h-7 w-fit max-w-full justify-start overflow-x-auto rounded-lg bg-muted/35 p-0.5">
                {secretFields.map((field) => {
                  const configured = isConfigured(field);
                  const active = activeFieldKey === field.key;
                  const method = connection?.methods.find(
                    (candidate) => candidate.field_key === field.key,
                  );
                  return (
                    <TabsTrigger
                      className="h-6 shrink-0 gap-1.5 rounded-md px-2.5 py-0 text-[10px] font-normal shadow-none data-[state=active]:bg-background data-[state=active]:font-medium data-[state=active]:shadow-none"
                      data-credential-active={active || undefined}
                      data-credential-configured={configured || undefined}
                      key={field.key}
                      value={field.key}
                    >
                      {providerConnectionMethodLabel(method, field, t)}
                      {active ? (
                        <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--success))]" />
                      ) : configured ? (
                        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/35" />
                      ) : null}
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              {secretFields.map((field) => (
                <TabsContent className="mt-3" key={field.key} value={field.key}>
                  <CredentialField
                    field={field}
                    onChange={onChange}
                    value={values[field.key] ?? ""}
                  />
                </TabsContent>
              ))}
            </Tabs>
          ) : selectedField ? (
            <CredentialField
              field={selectedField}
              onChange={onChange}
              value={values[selectedField.key] ?? ""}
            />
          ) : null}
        </div>
      ) : null}

      {discoveredMethods.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[10px] font-medium text-muted-foreground">
            {t("options.models.provider.connection.otherMethods")}
          </p>
          <div className="divide-y divide-border/50 rounded-lg border border-border/60">
            {discoveredMethods.map((method) => (
              <div
                className="flex items-center gap-2.5 px-3 py-2"
                key={method.id}
              >
                <MethodIcon method={method} />
                <span className="min-w-0 flex-1 truncate text-[10px] text-foreground">
                  {providerConnectionMethodLabel(method, undefined, t)}
                </span>
                <span className="text-[9px] text-muted-foreground">
                  {t("options.models.provider.connection.detectedNotUsed")}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {sharedFields.length > 0 ? (
        <div className="space-y-3">
          {sharedFields.map((field) => (
            <CredentialField
              field={field}
              key={field.key}
              onChange={onChange}
              value={values[field.key] ?? ""}
            />
          ))}
        </div>
      ) : null}

      {(localizedAuthHint || authHint) &&
      !(provider === "copilot" && connection) ? (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {localizedAuthHint ? t(localizedAuthHint) : authHint}
        </p>
      ) : null}

      {fields.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            disabled={saving}
            onClick={() => onSave(selectedField?.key)}
            size="sm"
            type="button"
          >
            {saving
              ? t("common.saving")
              : t("options.models.provider.saveCredentials")}
          </Button>
          {saved ? (
            <span className="text-xs text-[hsl(var(--success))]">
              {t("options.models.provider.saved")}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
