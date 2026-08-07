import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Loader2,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  getHermesComputerUseStatus,
  getHermesTerminalBackends,
  getHermesToolsetModels,
  hermesModelGateway,
  postHermesComputerUseGrant,
  postHermesToolsetSetup,
  putHermesTerminalBackend,
  putHermesTerminalEnv,
  putHermesToolsetEnv,
  putHermesToolsetModel,
  putHermesToolsetProvider,
  type AuxiliaryTask,
  type HermesComputerUseStatus,
  type HermesAgentMainModelResponse,
  type HermesModelCatalogResponse,
  type HermesTerminalBackend,
  type HermesToolEnvVar,
  type HermesToolModel,
  type HermesToolMutationResponse,
  type HermesToolProvider,
  type HermesToolsetDetail,
} from "@amiba/core";
import { useT, type ResolvedLanguage } from "@amiba/i18n";

import {
  ModelIdentityName,
  ModelSelectionField,
  resolveCatalogModelDisplayName,
  type ModelSelectionValue,
} from "../models";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from "../primitives";
import { getPostSetupInfo, type PostSetupKind } from "./post-setup-info";

export function ToolsetConfiguration({
  detail,
  onChanged,
  profileId,
}: {
  detail: HermesToolsetDetail;
  onChanged: () => Promise<void> | void;
  profileId?: string;
}) {
  if (detail.name === "vision" || detail.name === "video") {
    return (
      <UnderstandingModelConfiguration
        detail={detail}
        onChanged={onChanged}
        profileId={profileId}
      />
    );
  }

  if (detail.name === "terminal") {
    return (
      <TerminalBackendConfiguration
        onChanged={onChanged}
        profileId={profileId}
      />
    );
  }

  if (detail.name === "computer_use") {
    return (
      <div className="space-y-5">
        {detail.providers.length > 0 && (
          <ProviderConfigurationPanel
            detail={detail}
            onChanged={onChanged}
            profileId={profileId}
          />
        )}
        <ComputerUseConfiguration
          key={detail.providers.map((provider) => provider.status).join(":")}
        />
      </div>
    );
  }

  if (detail.providers.length > 0) {
    return (
      <ProviderConfigurationPanel
        detail={detail}
        onChanged={onChanged}
        profileId={profileId}
      />
    );
  }

  return (
    <NoConfiguration enabled={detail.enabled} configured={detail.configured} />
  );
}

function UnderstandingModelConfiguration({
  detail,
  onChanged,
  profileId,
}: {
  detail: HermesToolsetDetail;
  onChanged: () => Promise<void> | void;
  profileId?: string;
}) {
  const { t } = useT();
  const isVideo = detail.name === "video";
  const [main, setMain] = useState<HermesAgentMainModelResponse | null>(null);
  const [tasks, setTasks] = useState<AuxiliaryTask[]>([]);
  const [catalog, setCatalog] = useState<HermesModelCatalogResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const {
      main: mainResult,
      auxiliary: auxiliaryResult,
      catalog: catalogResult,
    } = await hermesModelGateway.workspace.read(false, profileId);
    setLoading(false);
    if (!mainResult.ok || !auxiliaryResult.ok || !catalogResult.ok) {
      setError(
        mainResult.error ||
          auxiliaryResult.error ||
          catalogResult.error ||
          t("tools.detail.understanding.loadFailed"),
      );
      return;
    }

    const nextTasks = auxiliaryResult.tasks ?? [];
    setMain(mainResult);
    setTasks(nextTasks);
    setCatalog(catalogResult);
  }, [profileId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const dedicated = tasks.find((item) => item.task === "vision");
  const route = dedicated?.model
    ? {
        mode: isVideo ? ("vision" as const) : ("dedicated" as const),
        provider: dedicated.provider,
        model: dedicated.model,
      }
    : {
        mode: "main" as const,
        provider: main?.provider || "",
        model: main?.model || "",
      };
  const selectedValue: ModelSelectionValue | null = dedicated?.model
    ? { provider: dedicated.provider, model: dedicated.model }
    : null;
  const selectedEntry = selectedValue
    ? catalog?.providers?.[selectedValue.provider]?.models.find(
        (entry) => entry.id === selectedValue.model,
      )
    : undefined;
  const routeEntry = route.model
    ? catalog?.providers?.[route.provider]?.models.find(
        (entry) => entry.id === route.model,
      )
    : undefined;

  async function setModelRoute(value: ModelSelectionValue | null) {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    const result = await hermesModelGateway.auxiliary.write(
      {
        task: "vision",
        provider: value?.provider ?? "",
        model: value?.model ?? "",
      },
      profileId,
    );
    setSaving(false);
    if (!result.ok) {
      setError(result.error || t("tools.detail.understanding.saveFailed"));
      return;
    }
    setTasks(result.tasks ?? []);
    setSaved(true);
    await onChanged();
  }

  if (loading && !main) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t("common.loading")}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-sm font-medium">
          {t("tools.detail.understanding.routeTitle")}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t(
            isVideo
              ? "tools.detail.understanding.videoDescription"
              : "tools.detail.understanding.imageDescription",
          )}
        </p>
        <div className="mt-3 flex items-start gap-3 rounded-md border border-border/60 bg-muted/15 p-3">
          <CheckCircle2
            className={cn(
              "mt-0.5 h-4 w-4 shrink-0",
              detail.configured ? "text-emerald-500" : "text-muted-foreground",
            )}
          />
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {t(
                route.mode === "dedicated"
                  ? "tools.detail.understanding.routeDedicated"
                  : route.mode === "vision"
                    ? "tools.detail.understanding.routeVision"
                    : "tools.detail.understanding.routeMain",
              )}
            </p>
            <div className="mt-1 text-xs text-muted-foreground">
              {route.model ? (
                <ModelIdentityName
                  displayName={
                    routeEntry
                      ? resolveCatalogModelDisplayName(routeEntry)
                      : undefined
                  }
                  model={route.model}
                  variant="picker"
                />
              ) : (
                t("tools.detail.understanding.noRoute")
              )}
            </div>
            {!isVideo && route.mode === "main" && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t(
                  main?.capabilities?.supports_vision === true
                    ? "tools.detail.understanding.mainSupportsImage"
                    : main?.capabilities?.supports_vision === false
                      ? "tools.detail.understanding.mainLacksImage"
                      : "tools.detail.understanding.mainImageUnknown",
                )}
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="border-t border-border/60 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">
              {t("tools.detail.understanding.chooseTitle")}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t(
                isVideo
                  ? "tools.detail.understanding.videoHint"
                  : "tools.detail.understanding.imageHint",
              )}
            </p>
          </div>
          <a
            href="#models"
            className="shrink-0 text-xs text-primary hover:underline"
          >
            {t("tools.detail.understanding.manageModels")}
          </a>
        </div>

        <div className="mt-3">
          <ModelSelectionField
            allowReset
            disabled={saving}
            displayName={
              selectedEntry
                ? resolveCatalogModelDisplayName(selectedEntry)
                : undefined
            }
            includeVirtualCapabilities={false}
            onChange={(value) => void setModelRoute(value)}
            pickerDescription={t("options.models.config.pickerDescription")}
            pickerTitle={t("options.models.config.pickerTitle", {
              task: t("options.models.config.slot.vision"),
            })}
            profileId={profileId}
            resetDescription={t(
              "options.models.config.useMainModelDescription",
            )}
            resetLabel={t("options.models.config.useMainModel")}
            searchPlaceholder={t("options.models.config.searchForTask", {
              task: t("options.models.config.slot.vision"),
            })}
            value={selectedValue}
          />
        </div>

        <div className="mt-2 flex min-h-5 items-center gap-2">
          {saving && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("common.saving")}
            </span>
          )}
          {saved && (
            <SuccessText>{t("tools.detail.understanding.saved")}</SuccessText>
          )}
        </div>
        {error && <InlineError>{error}</InlineError>}
      </section>
    </div>
  );
}

function NoConfiguration({
  enabled,
  configured,
}: {
  enabled: boolean;
  configured: boolean;
}) {
  const { t } = useT();
  const ready = enabled && configured;
  return (
    <div className="flex items-start gap-3 rounded-md border border-border/60 bg-muted/15 p-3">
      {ready ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
      ) : (
        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      <div>
        <p className="text-sm font-medium">
          {t(
            configured
              ? "tools.detail.noSetup.title"
              : "tools.detail.noSetup.unavailableTitle",
          )}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t(
            configured
              ? "tools.detail.noSetup.description"
              : "tools.detail.noSetup.unavailableDescription",
          )}
        </p>
      </div>
    </div>
  );
}

function ProviderConfigurationPanel({
  detail,
  onChanged,
  profileId,
}: {
  detail: HermesToolsetDetail;
  onChanged: () => Promise<void> | void;
  profileId?: string;
}) {
  const { t } = useT();
  const [webLane, setWebLane] = useState<"search" | "extract">("search");
  const isWeb = detail.name === "web";
  const providers = isWeb
    ? detail.providers.filter((provider) =>
        (provider.capabilities ?? []).includes(webLane),
      )
    : detail.providers;
  const activeBackend = isWeb
    ? webLane === "search"
      ? detail.active_search_backend
      : detail.active_extract_backend
    : null;
  const activeName = isWeb
    ? providers.find((provider) => provider.web_backend === activeBackend)?.name
    : detail.active_provider;

  return (
    <div>
      <div>
        <h3 className="text-sm font-medium">
          {t(
            detail.name === "browser"
              ? "tools.detail.browser.backgroundTitle"
              : "tools.detail.provider.title",
          )}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {detail.name === "browser"
            ? t("tools.detail.browser.backgroundDescription")
            : t("tools.detail.provider.subtitle")}
        </p>
      </div>

      {isWeb && (
        <div className="mt-3 inline-flex rounded-md border border-border/60 bg-muted/15 p-0.5">
          {(["search", "extract"] as const).map((lane) => (
            <button
              key={lane}
              type="button"
              onClick={() => setWebLane(lane)}
              className={cn(
                "rounded px-3 py-1.5 text-xs transition-colors",
                webLane === lane
                  ? "bg-background font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(
                lane === "search"
                  ? "tools.detail.provider.search"
                  : "tools.detail.provider.extract",
              )}
            </button>
          ))}
        </div>
      )}

      <ProviderList
        key={`${detail.name}:${isWeb ? webLane : "default"}`}
        detail={detail}
        providers={providers}
        activeName={activeName ?? null}
        capability={isWeb ? webLane : undefined}
        onChanged={onChanged}
        profileId={profileId}
      />
    </div>
  );
}

function ProviderList({
  detail,
  providers,
  activeName,
  capability,
  onChanged,
  profileId,
}: {
  detail: HermesToolsetDetail;
  providers: HermesToolProvider[];
  activeName: string | null;
  capability?: "search" | "extract";
  onChanged: () => Promise<void> | void;
  profileId?: string;
}) {
  const { t, language } = useT();
  const ordered = useMemo(
    () =>
      [...providers].sort((a, b) => {
        const score = (provider: HermesToolProvider) =>
          (provider.name === activeName ? 100 : 0) +
          (/recommended/i.test(provider.badge) ? 20 : 0) +
          (provider.status === "ready" ? 10 : 0);
        return score(b) - score(a);
      }),
    [activeName, providers],
  );
  const initial =
    ordered.find((provider) => provider.name === activeName) ??
    ordered.find((provider) => /recommended/i.test(provider.badge)) ??
    ordered[0];
  const [selectedName, setSelectedName] = useState(initial?.name ?? "");
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const selected =
    ordered.find((provider) => provider.name === selectedName) ?? initial;
  const normalizedBadge = selected?.badge.trim().toLowerCase();
  const badgeLabel = !normalizedBadge
    ? null
    : normalizedBadge === "recommended"
      ? t("tools.detail.provider.badge.recommended")
      : normalizedBadge === "subscription"
        ? t("tools.detail.provider.badge.subscription")
        : language === "en"
          ? selected?.badge
          : null;

  async function selectProvider(provider: HermesToolProvider) {
    setSelectedName(provider.name);
    setSaved(false);
    const alreadySelected = capability
      ? provider.web_backend ===
        (capability === "search"
          ? detail.active_search_backend
          : detail.active_extract_backend)
      : provider.name === activeName;
    if (alreadySelected) return;

    setSelecting(true);
    setError(null);
    const result = await putHermesToolsetProvider(
      detail.name,
      provider.name,
      capability,
      profileId,
    );
    setSelecting(false);
    if (!result.ok) {
      setError(
        t("tools.detail.mutationFailed", {
          error: result.error || "unknown",
        }),
      );
      return;
    }
    setSaved(true);
    await onChanged();
  }

  return (
    <div className="mt-3 space-y-4">
      <label className="block">
        <span className="text-xs font-medium">
          {t("tools.detail.provider.choose")}
        </span>
        <Select
          value={selected?.name ?? ""}
          disabled={selecting}
          onValueChange={(name) => {
            const provider = ordered.find((item) => item.name === name);
            if (provider) void selectProvider(provider);
          }}
        >
          <SelectTrigger className="mt-1.5 h-9 shadow-none">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ordered.map((provider) => (
              <SelectItem key={provider.name} value={provider.name}>
                {provider.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      {selected && (
        <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-muted/15 p-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium">{selected.name}</span>
              {badgeLabel && (
                <Badge
                  variant="outline"
                  className="h-5 px-1.5 text-[10px] font-normal"
                >
                  {badgeLabel}
                </Badge>
              )}
              {selected.name === activeName && (
                <Badge
                  variant="outline"
                  className="h-5 border-emerald-500/35 px-1.5 text-[10px] font-normal text-emerald-600 dark:text-emerald-300"
                >
                  {t("tools.detail.provider.active")}
                </Badge>
              )}
            </div>
            {selected.tag && language === "en" && (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {selected.tag}
              </p>
            )}
          </div>
          <ProviderStatus status={selected.status} />
        </div>
      )}

      {selecting && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("tools.detail.provider.selecting")}
        </p>
      )}
      {saved && !error && (
        <SuccessText>{t("tools.detail.credentials.saved")}</SuccessText>
      )}
      {error && <InlineError>{error}</InlineError>}

      {selected && (
        <div className="space-y-4 border-l border-border/60 pl-4">
          {selected.requires_nous_auth && selected.status !== "ready" && (
            <AuthRequired />
          )}
          {selected.env_vars.length > 0 && (
            <CredentialEditor
              identity={`${detail.name}:${selected.name}`}
              fields={selected.env_vars}
              saveValues={(values) =>
                putHermesToolsetEnv(detail.name, values, profileId)
              }
              onChanged={onChanged}
            />
          )}
          {selected.post_setup && (
            <PostSetup
              providerName={selected.name}
              toolsetName={detail.name}
              setupKey={selected.post_setup}
              ready={selected.status === "ready"}
              onChanged={onChanged}
              profileId={profileId}
            />
          )}
          {(detail.name === "image_gen" || detail.name === "video_gen") && (
            <ModelPicker
              toolsetName={detail.name}
              providerName={selected.name}
              profileId={profileId}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ProviderStatus({ status }: { status: string }) {
  const { t } = useT();
  const key =
    status === "ready"
      ? "tools.detail.provider.status.ready"
      : status === "needs_key" || status === "needs_keys"
        ? "tools.detail.provider.status.needsKey"
        : status === "needs_auth"
          ? "tools.detail.provider.status.needsAuth"
          : status === "needs_setup"
            ? "tools.detail.provider.status.needsSetup"
            : "tools.detail.provider.status.inactive";
  return (
    <span
      className={cn(
        "mt-0.5 shrink-0 text-xs",
        status === "ready"
          ? "text-emerald-600 dark:text-emerald-300"
          : status === "needs_key" ||
              status === "needs_keys" ||
              status === "needs_auth" ||
              status === "needs_setup"
            ? "text-amber-600 dark:text-amber-300"
            : "text-muted-foreground",
      )}
    >
      {t(key)}
    </span>
  );
}

function AuthRequired() {
  const { t } = useT();
  return (
    <div className="flex items-start gap-3 rounded-md border border-amber-500/25 bg-amber-500/5 p-3">
      <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div>
        <p className="text-sm font-medium">{t("tools.detail.auth.title")}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t("tools.detail.auth.description")}
        </p>
      </div>
    </div>
  );
}

function CredentialEditor({
  identity,
  fields,
  saveValues,
  onChanged,
  title,
  description,
}: {
  identity: string;
  fields: HermesToolEnvVar[];
  saveValues: (
    values: Record<string, string>,
  ) => Promise<HermesToolMutationResponse>;
  onChanged: () => Promise<void> | void;
  title?: string;
  description?: string;
}) {
  const { t } = useT();
  const [values, setValues] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValues({});
    setRevealed(new Set());
    setSaving(false);
    setSaved(false);
    setError(null);
  }, [identity]);

  const changed = fields.some(
    (field) => field.key && (values[field.key] || "").trim(),
  );

  async function save() {
    const payload: Record<string, string> = {};
    for (const field of fields) {
      if (!field.key) continue;
      const value = (values[field.key] || "").trim();
      if (value) payload[field.key] = value;
    }
    if (Object.keys(payload).length === 0) return;

    setSaving(true);
    setSaved(false);
    setError(null);
    const result = await saveValues(payload);
    setSaving(false);
    if (!result.ok) {
      setError(
        t("tools.detail.mutationFailed", {
          error: result.error || "unknown",
        }),
      );
      return;
    }
    setValues({});
    setSaved(true);
    await onChanged();
  }

  return (
    <section>
      <div className="flex items-start gap-2">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div>
          <h4 className="text-sm font-medium">
            {title || t("tools.detail.credentials.title")}
          </h4>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {description || t("tools.detail.credentials.description")}
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {fields.map((field) => {
          const key = field.key || field.prompt || "value";
          const isUrl = /(?:_URL|_BASE_URL)$/i.test(field.key || "");
          const isSecret = field.secret ?? !isUrl;
          const visible = !isSecret || revealed.has(key);
          return (
            <label key={key} className="block">
              <span className="flex items-center justify-between gap-3 text-xs font-medium">
                <span>{String(field.prompt || field.key || "Value")}</span>
                {field.url && (
                  <a
                    href={field.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-normal text-primary hover:underline"
                  >
                    {t("tools.detail.credentials.openProvider")}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </span>
              <span className="relative mt-1.5 block">
                <Input
                  type={visible ? "text" : "password"}
                  aria-label={String(field.prompt || field.key || "Value")}
                  autoComplete="off"
                  value={field.key ? values[field.key] || "" : ""}
                  onChange={(event) => {
                    if (!field.key) return;
                    setValues((current) => ({
                      ...current,
                      [field.key as string]: event.target.value,
                    }));
                    setSaved(false);
                  }}
                  placeholder={
                    field.is_set
                      ? t("tools.detail.credentials.savedPlaceholder")
                      : field.default || ""
                  }
                  className={cn("h-8 shadow-none", isSecret && "pr-8")}
                />
                {isSecret && (
                  <button
                    type="button"
                    onClick={() =>
                      setRevealed((current) => {
                        const next = new Set(current);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                    className="absolute right-0 top-0 flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground"
                    aria-label={t(
                      visible
                        ? "tools.detail.credentials.hide"
                        : "tools.detail.credentials.show",
                    )}
                  >
                    {visible ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
              </span>
            </label>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          onClick={() => void save()}
          disabled={!changed || saving}
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t(
            saving
              ? "tools.detail.credentials.saving"
              : "tools.detail.credentials.save",
          )}
        </Button>
        {saved && (
          <SuccessText>{t("tools.detail.credentials.saved")}</SuccessText>
        )}
      </div>
      {error && <InlineError>{error}</InlineError>}
    </section>
  );
}

function PostSetup({
  providerName,
  toolsetName,
  setupKey,
  ready,
  onChanged,
  profileId,
}: {
  providerName: string;
  toolsetName: string;
  setupKey: string;
  ready: boolean;
  onChanged: () => Promise<void> | void;
  profileId?: string;
}) {
  const { t } = useT();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const info = getPostSetupInfo(setupKey);
  const completed = ready || done;

  async function run() {
    setRunning(true);
    setError(null);
    const result = await postHermesToolsetSetup(
      toolsetName,
      setupKey,
      profileId,
    );
    setRunning(false);
    if (!result.ok) {
      setError(
        t("tools.detail.mutationFailed", {
          error: result.error || "unknown",
        }),
      );
      return;
    }
    setDone(true);
    await onChanged();
  }

  return (
    <section className="rounded-md border border-border/60 bg-muted/15 px-3 py-2.5">
      <div className="flex min-h-8 items-center gap-2.5">
        <PostSetupKindIcon kind={info.kind} />
        <div className="flex min-w-0 flex-1 items-center gap-0.5">
          <h4 className="truncate text-sm font-medium">{t(info.titleKey)}</h4>
          <PostSetupInfoDialog
            providerName={providerName}
            setupKey={setupKey}
          />
        </div>
        {completed ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t("tools.detail.setup.done")}
          </span>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={running}
            onClick={() => void run()}
          >
            {running && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t(
              running
                ? setupActionKey(info.kind, true)
                : setupActionKey(info.kind, false),
            )}
          </Button>
        )}
      </div>
      {error && <InlineError>{error}</InlineError>}
    </section>
  );
}

function setupActionKey(kind: PostSetupKind, running: boolean) {
  if (kind === "connect") {
    return running
      ? ("tools.detail.setup.connecting" as const)
      : ("tools.detail.setup.connect" as const);
  }
  if (kind === "configure") {
    return running
      ? ("tools.detail.setup.configuring" as const)
      : ("tools.detail.setup.configure" as const);
  }
  return running
    ? ("tools.detail.setup.running" as const)
    : ("tools.detail.setup.run" as const);
}

function PostSetupKindIcon({ kind }: { kind: PostSetupKind }) {
  const Icon =
    kind === "connect" ? KeyRound : kind === "configure" ? Settings2 : Download;
  return <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

function PostSetupInfoDialog({
  providerName,
  setupKey,
}: {
  providerName: string;
  setupKey: string;
}) {
  const { t } = useT();
  const info = getPostSetupInfo(setupKey);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("tools.detail.setup.info.open", {
            name: t(info.titleKey),
          })}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="gap-0 overflow-hidden p-0" size="compact">
        <DialogHeader className="px-5 pb-4 pt-5 pr-12">
          <DialogTitle className="text-base">{t(info.titleKey)}</DialogTitle>
          <DialogDescription className="pt-1 text-xs leading-relaxed">
            {t(info.descriptionKey)}
          </DialogDescription>
        </DialogHeader>
        <div className="border-t border-border/60 px-5 py-4">
          <p className="text-xs font-medium text-foreground">
            {t("tools.detail.setup.info.changes")}
          </p>
          <ul className="mt-2.5 space-y-2">
            {info.detailKeys.map((key) => (
              <li
                key={key}
                className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"
              >
                <span className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
          {info.noteKey && (
            <p className="mt-3 border-t border-border/50 pt-3 text-xs leading-relaxed text-muted-foreground">
              {t(info.noteKey)}
            </p>
          )}
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-border/60 bg-muted/20 px-5 py-2.5 text-[11px] text-muted-foreground">
          <span className="truncate">{providerName}</span>
          <span className="shrink-0 font-mono">Amiba · {setupKey}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ModelPicker({
  toolsetName,
  providerName,
  profileId,
}: {
  toolsetName: string;
  providerName: string;
  profileId?: string;
}) {
  const { t } = useT();
  const [models, setModels] = useState<HermesToolModel[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    void getHermesToolsetModels(toolsetName, providerName, profileId).then(
      (result) => {
        if (!mounted) return;
        setLoading(false);
        if (!result.ok) {
          setError(result.error || "Unable to load models");
          return;
        }
        setModels(result.models);
        setSelected(
          result.current || result.default || result.models[0]?.id || "",
        );
      },
    );
    return () => {
      mounted = false;
    };
  }, [profileId, providerName, toolsetName]);

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t("common.loading")}
      </p>
    );
  }
  if (models.length === 0)
    return error ? <InlineError>{error}</InlineError> : null;

  async function save() {
    if (!selected) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    const result = await putHermesToolsetModel(
      toolsetName,
      selected,
      providerName,
      profileId,
    );
    setSaving(false);
    if (!result.ok) {
      setError(result.error || "Unable to save model");
      return;
    }
    setSaved(true);
  }

  return (
    <section>
      <h4 className="text-sm font-medium">{t("tools.detail.model.title")}</h4>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {t("tools.detail.model.description")}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger className="h-8 min-w-0 flex-1 shadow-none">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {models.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                <span className="block font-medium">{model.display}</span>
                {(model.speed || model.price) && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {[model.speed, model.price].filter(Boolean).join(" · ")}
                  </span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={saving || !selected}
          onClick={() => void save()}
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t("tools.detail.model.save")}
        </Button>
      </div>
      {saved && (
        <SuccessText>{t("tools.detail.credentials.saved")}</SuccessText>
      )}
      {error && <InlineError>{error}</InlineError>}
    </section>
  );
}

function terminalBackendCopy(
  backend: HermesTerminalBackend,
  language: ResolvedLanguage,
): { label: string; description: string } {
  const localized: Record<
    string,
    {
      en: { label: string; description: string };
      "zh-CN": { label: string; description: string };
    }
  > = {
    local: {
      en: {
        label: "Local",
        description: "Run commands directly on this computer.",
      },
      "zh-CN": {
        label: "本机",
        description: "直接在这台电脑上执行命令。",
      },
    },
    docker: {
      en: {
        label: "Docker",
        description: "Run commands in an isolated Docker container.",
      },
      "zh-CN": {
        label: "Docker",
        description: "在隔离的 Docker 容器中执行命令。",
      },
    },
    singularity: {
      en: {
        label: "Singularity / Apptainer",
        description: "Use a rootless container for HPC environments.",
      },
      "zh-CN": {
        label: "Singularity / Apptainer",
        description: "使用适合 HPC 环境的无 root 容器。",
      },
    },
    modal: {
      en: {
        label: "Modal",
        description: "Run commands in a Modal cloud sandbox.",
      },
      "zh-CN": {
        label: "Modal",
        description: "在 Modal 云沙箱中执行命令。",
      },
    },
    daytona: {
      en: {
        label: "Daytona",
        description: "Use a persistent Daytona cloud workspace.",
      },
      "zh-CN": {
        label: "Daytona",
        description: "使用可持续保存的 Daytona 云工作区。",
      },
    },
    ssh: {
      en: {
        label: "SSH",
        description: "Run commands on another computer over SSH.",
      },
      "zh-CN": {
        label: "SSH",
        description: "通过 SSH 在另一台电脑上执行命令。",
      },
    },
  };
  return (
    localized[backend.name]?.[language] ?? {
      label: backend.label,
      description: backend.description,
    }
  );
}

function TerminalBackendConfiguration({
  onChanged,
  profileId,
}: {
  onChanged: () => Promise<void> | void;
  profileId?: string;
}) {
  const { t, language } = useT();
  const [backends, setBackends] = useState<HermesTerminalBackend[]>([]);
  const [active, setActive] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await getHermesTerminalBackends(profileId);
    setLoading(false);
    if (!result.ok) {
      setError(
        t("tools.detail.mutationFailed", {
          error: result.error || "unknown",
        }),
      );
      return;
    }
    setBackends(result.backends);
    setActive(result.active);
  }, [profileId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function selectBackend(backend: HermesTerminalBackend) {
    if (saving || backend.name === active) return;
    setSaving(true);
    setError(null);
    const result = await putHermesTerminalBackend(backend.name, profileId);
    setSaving(false);
    if (!result.ok) {
      setError(
        t("tools.detail.mutationFailed", {
          error: result.error || "unknown",
        }),
      );
      return;
    }
    setActive(backend.name);
    await Promise.all([load(), onChanged()]);
  }

  const selected = backends.find((backend) => backend.name === active);
  return (
    <div>
      <div className="flex items-start gap-2">
        <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div>
          <h3 className="text-sm font-medium">
            {t("tools.detail.terminal.title")}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t("tools.detail.terminal.description")}
          </p>
        </div>
      </div>

      {loading && backends.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("common.loading")}
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <Select
            value={active}
            disabled={saving}
            onValueChange={(name) => {
              const backend = backends.find((item) => item.name === name);
              if (backend) void selectBackend(backend);
            }}
          >
            <SelectTrigger className="h-9 shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {backends.map((backend) => (
                <SelectItem key={backend.name} value={backend.name}>
                  {terminalBackendCopy(backend, language).label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selected && (
            <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-muted/15 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {terminalBackendCopy(selected, language).label}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {terminalBackendCopy(selected, language).description}
                </p>
              </div>
              <TerminalBackendStatus status={selected.status} />
            </div>
          )}
        </div>
      )}

      {selected?.detail && selected.status !== "ready" && (
        <p className="mt-3 text-xs leading-relaxed text-amber-600 dark:text-amber-300">
          {selected.detail}
        </p>
      )}
      {selected && selected.fields.length > 0 && (
        <div className="mt-5 border-l border-border/60 pl-4">
          <CredentialEditor
            identity={`terminal:${selected.name}`}
            fields={selected.fields}
            saveValues={(values) => putHermesTerminalEnv(values, profileId)}
            onChanged={async () => {
              await Promise.all([load(), onChanged()]);
            }}
            title={t("tools.detail.terminal.connectionTitle")}
            description={t("tools.detail.terminal.connectionDescription")}
          />
        </div>
      )}
      {error && <InlineError>{error}</InlineError>}
    </div>
  );
}

function TerminalBackendStatus({ status }: { status: string }) {
  const { t } = useT();
  return (
    <span
      className={cn(
        "mt-0.5 shrink-0 text-xs",
        status === "ready"
          ? "text-emerald-600 dark:text-emerald-300"
          : status === "needs_setup"
            ? "text-amber-600 dark:text-amber-300"
            : "text-muted-foreground",
      )}
    >
      {t(
        status === "ready"
          ? "tools.detail.terminal.ready"
          : status === "needs_setup"
            ? "tools.detail.terminal.needsSetup"
            : "tools.detail.terminal.unavailable",
      )}
    </span>
  );
}

function ComputerUseConfiguration() {
  const { t } = useT();
  const [status, setStatus] = useState<HermesComputerUseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [granting, setGranting] = useState(false);
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getHermesComputerUseStatus();
    setLoading(false);
    if (!result.ok) {
      setError(
        t("tools.detail.mutationFailed", {
          error: result.error || "unknown",
        }),
      );
      return;
    }
    setStatus(result);
    setError(null);
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function grant() {
    setGranting(true);
    setError(null);
    const result = await postHermesComputerUseGrant();
    setGranting(false);
    if (!result.ok) {
      setError(
        t("tools.detail.mutationFailed", {
          error: result.error || "unknown",
        }),
      );
      return;
    }
    setRequested(true);
    window.setTimeout(() => void load(), 2000);
  }

  return (
    <section className="rounded-md border border-border/60 bg-muted/15 p-3">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium">
                  {t("tools.detail.computer.title")}
                </h3>
                <Badge
                  className="h-5 rounded-full px-2 text-[10px] font-normal"
                  variant="outline"
                >
                  {t("agentCapabilities.scope.device")}
                </Badge>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t("tools.detail.computer.description")}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", loading && "animate-spin")}
              />
              {t("tools.detail.refresh")}
            </Button>
          </div>

          {status && (
            <div className="mt-4 space-y-2">
              <ReadinessRow
                label={t("tools.detail.computer.driver")}
                done={status.installed}
                detail={status.version || undefined}
              />
              {status.platform === "darwin" && status.installed && (
                <>
                  <ReadinessRow
                    label={t("tools.detail.computer.accessibility")}
                    done={status.accessibility === true}
                  />
                  <ReadinessRow
                    label={t("tools.detail.computer.screen")}
                    done={status.screen_recording === true}
                  />
                </>
              )}
            </div>
          )}

          {status?.ready ? (
            <SuccessText>{t("tools.detail.computer.ready")}</SuccessText>
          ) : status?.installed && status.can_grant ? (
            <div className="mt-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={granting}
                onClick={() => void grant()}
              >
                {granting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t("tools.detail.computer.grant")}
              </Button>
              {requested && (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {t("tools.detail.computer.requested")}
                </p>
              )}
            </div>
          ) : status && !status.installed ? (
            <p className="mt-4 text-xs leading-relaxed text-amber-600 dark:text-amber-300">
              {t("tools.detail.computer.installFirst")}
            </p>
          ) : null}
          {error && <InlineError>{error}</InlineError>}
        </div>
      </div>
    </section>
  );
}

function ReadinessRow({
  label,
  done,
  detail,
}: {
  label: string;
  done: boolean;
  detail?: string;
}) {
  const { t } = useT();
  return (
    <div className="flex items-center gap-2 text-xs">
      {done ? (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
      ) : (
        <Circle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
      )}
      <span className="flex-1">{label}</span>
      {detail ? (
        <span className="text-muted-foreground">{detail}</span>
      ) : (
        <span className="text-muted-foreground">
          {t(done ? "tools.detail.journey.done" : "tools.detail.journey.todo")}
        </span>
      )}
    </div>
  );
}

function SuccessText({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-300">
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
      {children}
    </p>
  );
}

function InlineError({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
      <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
