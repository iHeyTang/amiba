import {
  CircleDashed,
  ExternalLink,
  Eye,
  EyeOff,
  Github,
  KeyRound,
  LogIn,
  Plus,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  HermesProviderConnection,
  HermesProviderConnectionMethod,
  HermesProviderCredentialField,
  HermesProviderEndpointResolution,
  HermesOAuthSession,
  HermesCredentialPoolEntry,
} from "@amiba/core";
import {
  cancelHermesOAuth,
  getHermesOAuthSession,
  sendHermesOAuthInput,
  startHermesOAuth,
  getHermesCredentialPool,
  addHermesCredentialPoolEntry,
  removeHermesCredentialPoolEntry,
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
  endpoint?: HermesProviderEndpointResolution;
  fields: HermesProviderCredentialField[];
  loading: boolean;
  onChange: (key: string, value: string) => void;
  onSave: (activeCredentialKey?: string) => void;
  provider: string;
  saved: boolean;
  saving: boolean;
  values: Record<string, string>;
  profileId?: string;
  onOAuthComplete?: () => void;
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
  defaultBaseUrl,
  field,
  onChange,
  value,
}: {
  defaultBaseUrl?: string;
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
            (field.kind === "url" ? defaultBaseUrl : "") ||
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
  endpoint,
  error,
  fields,
  loading,
  onChange,
  onSave,
  provider,
  saved,
  saving,
  values,
  profileId,
  onOAuthComplete,
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
  const [oauth, setOauth] = useState<HermesOAuthSession | null>(null);
  const [oauthInput, setOauthInput] = useState("");
  const [oauthBusy, setOauthBusy] = useState(false);
  const [pool, setPool] = useState<HermesCredentialPoolEntry[]>([]);
  const [poolLabel, setPoolLabel] = useState("");
  const [poolKey, setPoolKey] = useState("");
  const [poolError, setPoolError] = useState<string | null>(null);
  const [poolBusy, setPoolBusy] = useState(false);

  useEffect(() => {
    setSelectedCredential(
      resolvedCredential?.key ?? secretFields[0]?.key ?? "",
    );
    // Reset only when the provider/schema changes. Draft edits must not pull
    // the user back to the currently effective method.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, secretFieldKey]);

  useEffect(() => {
    let cancelled = false;
    void getHermesCredentialPool(provider, profileId).then((result) => {
      if (cancelled) return;
      if (result.ok) setPool(result.entries);
      else setPoolError(result.error || "Could not load credential pool");
    });
    return () => {
      cancelled = true;
    };
  }, [profileId, provider]);

  async function refreshPool() {
    const result = await getHermesCredentialPool(provider, profileId);
    if (result.ok) setPool(result.entries);
    else setPoolError(result.error || "Could not load credential pool");
  }

  useEffect(() => {
    if (!oauth?.session_id || !oauth.running) return;
    const id = window.setInterval(() => {
      void getHermesOAuthSession(oauth.session_id!, profileId).then((next) => {
        setOauth(next);
        if (next.ok && !next.running && next.exit_code === 0)
          onOAuthComplete?.();
      });
    }, 1_000);
    return () => window.clearInterval(id);
  }, [oauth?.running, oauth?.session_id, onOAuthComplete, profileId]);

  const supportsOAuth = Boolean(
    authType?.trim().toLowerCase().startsWith("oauth") ||
      connection?.methods.some((method) => method.kind === "oauth"),
  );
  const oauthUrl = oauth?.output?.match(/https?:\/\/[^\s\]\[()<>"']+/)?.[0];

  async function startOAuth() {
    setOauthBusy(true);
    const result = await startHermesOAuth(provider, profileId);
    setOauthBusy(false);
    setOauth(result);
  }

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

      {supportsOAuth ? (
        <div className="space-y-2 rounded-lg border border-border/60 bg-muted/15 p-3">
          <div className="flex items-center gap-2">
            <LogIn className="h-4 w-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 text-xs font-medium">
              OAuth sign-in
            </span>
            {!oauth?.running ? (
              <Button
                disabled={oauthBusy}
                onClick={() => void startOAuth()}
                size="sm"
                type="button"
                variant="outline"
              >
                {oauthBusy ? (
                  <CircleDashed className="animate-spin" />
                ) : (
                  <LogIn />
                )}
                Sign in
              </Button>
            ) : (
              <Button
                onClick={() =>
                  void cancelHermesOAuth(oauth.session_id!, profileId).then(
                    () => setOauth(null),
                  )
                }
                size="sm"
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
            )}
          </div>
          {oauth ? (
            <>
              {oauthUrl ? (
                <Button
                  onClick={() =>
                    window.open(oauthUrl, "_blank", "noopener,noreferrer")
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <ExternalLink />
                  Open sign-in page
                </Button>
              ) : null}
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-md bg-background px-2.5 py-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                {oauth.output || "Starting sign-in…"}
              </pre>
              {oauth.running ? (
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!oauthInput.trim()) return;
                    void sendHermesOAuthInput(
                      oauth.session_id!,
                      oauthInput,
                      profileId,
                    ).then(setOauth);
                    setOauthInput("");
                  }}
                >
                  <Input
                    className="h-8 flex-1 font-mono text-xs"
                    onChange={(event) => setOauthInput(event.target.value)}
                    placeholder="Paste authorization code or answer"
                    value={oauthInput}
                  />
                  <Button disabled={!oauthInput.trim()} size="sm" type="submit">
                    Send
                  </Button>
                </form>
              ) : (
                <p
                  className={cn(
                    "text-[10px]",
                    oauth.exit_code === 0
                      ? "text-[hsl(var(--success))]"
                      : "text-destructive",
                  )}
                >
                  {oauth.exit_code === 0
                    ? "Sign-in complete"
                    : oauth.error ||
                      `Sign-in exited with code ${oauth.exit_code}`}
                </p>
              )}
            </>
          ) : null}
        </div>
      ) : null}

      <details className="rounded-lg border border-border/60 bg-muted/10">
        <summary className="cursor-pointer px-3 py-2.5 text-xs font-medium">
          Credential pool · {pool.length}
        </summary>
        <div className="space-y-2 border-t border-border/50 p-3">
          {poolError ? (
            <p className="text-[10px] text-destructive">{poolError}</p>
          ) : null}
          {pool.length ? (
            <ul className="divide-y divide-border/50 rounded-lg border border-border/50 bg-background">
              {pool.map((entry) => (
                <li
                  className="flex items-center gap-2 px-2.5 py-2 text-[10px]"
                  key={`${entry.index}:${entry.id}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {entry.label || entry.source || `Key ${entry.index}`}
                    </span>
                    <span className="font-mono text-muted-foreground">
                      {entry.token_preview} · {entry.request_count} requests
                      {entry.last_status ? ` · ${entry.last_status}` : ""}
                    </span>
                  </span>
                  <Button
                    className="text-destructive hover:text-destructive"
                    disabled={poolBusy}
                    onClick={() =>
                      void (async () => {
                        if (
                          !confirm(
                            `Remove credential “${entry.label || entry.index}”?`,
                          )
                        )
                          return;
                        setPoolBusy(true);
                        const result = await removeHermesCredentialPoolEntry(
                          provider,
                          entry.index,
                          profileId,
                        );
                        setPoolBusy(false);
                        if (!result.ok)
                          setPoolError(result.error || "Remove failed");
                        else await refreshPool();
                      })()
                    }
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              No rotating credentials for this provider.
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-[140px_1fr_auto]">
            <Input
              className="h-8 text-xs"
              onChange={(event) => setPoolLabel(event.target.value)}
              placeholder="Label"
              value={poolLabel}
            />
            <Input
              autoComplete="off"
              className="h-8 font-mono text-xs"
              onChange={(event) => setPoolKey(event.target.value)}
              placeholder="Additional API key"
              type="password"
              value={poolKey}
            />
            <Button
              disabled={poolBusy || !poolKey.trim()}
              onClick={() =>
                void (async () => {
                  setPoolBusy(true);
                  setPoolError(null);
                  const result = await addHermesCredentialPoolEntry(
                    provider,
                    poolKey,
                    poolLabel,
                    profileId,
                  );
                  setPoolBusy(false);
                  if (!result.ok) setPoolError(result.error || "Add failed");
                  else {
                    setPoolKey("");
                    setPoolLabel("");
                    await refreshPool();
                  }
                })()
              }
              size="sm"
              type="button"
            >
              <Plus />
              Add
            </Button>
          </div>
        </div>
      </details>

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
                    defaultBaseUrl={endpoint?.default_base_url}
                    field={field}
                    onChange={onChange}
                    value={values[field.key] ?? ""}
                  />
                </TabsContent>
              ))}
            </Tabs>
          ) : selectedField ? (
            <CredentialField
              defaultBaseUrl={endpoint?.default_base_url}
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
              defaultBaseUrl={endpoint?.default_base_url}
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
