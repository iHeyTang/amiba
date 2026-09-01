import {
  Cable,
  Check,
  CircleAlert,
  Loader2,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Label,
  PageContent,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsPageDescription,
  Textarea,
  cn,
  usePluginT,
  type PluginTranslateFn,
} from "@amiba/ui/plugin";

import type { ConnectAdapter, CreateConnectInput } from "./adapter.js";
import { connectI18n } from "./i18n.js";
import type { ConnectorProviderView, ConnectorStatus, ConnectView } from "../types.js";

/**
 * Wraps `usePluginT` with this plugin's own i18n overlay (see `./i18n.ts`).
 * Every call site in this file should use this, not the bare `usePluginT`,
 * so overlay-covered keys resolve locally instead of depending on the host
 * `options.connect.*` bundle. Mirrors `DshSettingsMessaging`'s `useT()`.
 */
function useT() {
  return usePluginT(connectI18n);
}

/** Maps known `ConnectorCenter#createConnect` failure codes to translated copy. */
const KNOWN_CREATE_ERRORS: Record<string, string> = {
  agent_preset_required: "options.connect.dsh.error.agent_preset_required",
  provider_not_found: "options.connect.dsh.error.provider_not_found",
};

function describeError(t: PluginTranslateFn, cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  const key = KNOWN_CREATE_ERRORS[message];
  return key ? t(key) : message;
}

/**
 * Plain, directly-testable props — deliberately NOT `PropsRuntime<"settings
 * .section">`. That runtime type pulls in framework-mandatory members
 * (`close`, `useSessions`, `useWorkspaces` from `@deepseek-ai/dsh-client-
 * runtime`'s `GlobalStandardProps`/`SettingsSectionOwnerProps` module
 * augmentation) that only the real slot machinery can supply, which would
 * make this component impossible to `render()` directly in a unit test.
 * `./index.tsx` registers a thin wrapper typed with the full runtime props
 * and forwards just `adapter` here — the same split
 * `DshSettingsMessaging`/`MessagingSettings` uses in the messaging-core
 * sibling.
 */
export interface DshSettingsConnectProps {
  adapter: ConnectAdapter;
}

export function DshSettingsConnect({ adapter }: DshSettingsConnectProps) {
  const { t } = useT();
  const [providers, setProviders] = useState<ConnectorProviderView[]>([]);
  const [connects, setConnects] = useState<ConnectView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [expandedOwnersId, setExpandedOwnersId] = useState<string | null>(
    null,
  );
  const [ownerDraft, setOwnerDraft] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextProviders, nextConnects] = await Promise.all([
        adapter.listProviders(),
        adapter.list(),
      ]);
      setProviders(nextProviders);
      setConnects(nextConnects);
      setError(null);
    } catch (cause) {
      setError(describeError(t, cause));
    } finally {
      setLoading(false);
    }
  }, [adapter, t]);

  useEffect(() => {
    void refresh();
    // Only re-run when the adapter identity changes; `t` is stable enough
    // per render and re-running on every locale switch would refetch data
    // that never changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter]);

  async function mutate(id: string, operation: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setError(describeError(t, cause));
    } finally {
      setBusyId(null);
    }
  }

  function toggleOwners(id: string) {
    setExpandedOwnersId((current) => (current === id ? null : id));
    setOwnerDraft("");
  }

  function addOwner(connect: ConnectView) {
    const value = ownerDraft.trim();
    if (!value || connect.owners.includes(value)) return;
    setOwnerDraft("");
    void mutate(connect.id, () =>
      adapter.setOwners(connect.id, [...connect.owners, value]),
    );
  }

  function removeOwner(connect: ConnectView, owner: string) {
    void mutate(connect.id, () =>
      adapter.setOwners(
        connect.id,
        connect.owners.filter((existing) => existing !== owner),
      ),
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <PageContent bodyClassName="space-y-4" className="pt-3" size="md">
          <SettingsPageDescription>
            {t("options.connect.dsh.description")}
          </SettingsPageDescription>

          {error ? (
            <div
              className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-destructive"
              role="alert"
            >
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">{error}</span>
            </div>
          ) : null}

          <div className="flex items-start justify-end gap-3">
            <div className="flex flex-col items-end gap-1">
              <Button
                disabled={providers.length === 0}
                onClick={() => setAdding(true)}
                size="sm"
              >
                <Plus />
                {t("options.connect.dsh.add")}
              </Button>
              {providers.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  {t("options.connect.dsh.noProviders")}
                </p>
              ) : null}
            </div>
          </div>

          {loading && !connects.length && !providers.length ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 px-4 py-10 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("options.connect.dsh.loading")}
            </div>
          ) : connects.length ? (
            <div className="space-y-2">
              {connects.map((connect) => (
                <ConnectRow
                  busy={busyId === connect.id}
                  connect={connect}
                  key={connect.id}
                  onAddOwner={() => addOwner(connect)}
                  onCancelRemove={() => setRemovingId(null)}
                  onConfirmRemove={() =>
                    void mutate(connect.id, async () => {
                      await adapter.remove(connect.id);
                      setRemovingId(null);
                    })
                  }
                  onOwnerDraftChange={setOwnerDraft}
                  onRemoveOwner={(owner) => removeOwner(connect, owner)}
                  onStartRemove={() => setRemovingId(connect.id)}
                  onToggleEnabled={() =>
                    void mutate(connect.id, () =>
                      adapter.setEnabled(connect.id, !connect.enabled),
                    )
                  }
                  onToggleOwners={() => toggleOwners(connect.id)}
                  ownerDraft={ownerDraft}
                  ownersExpanded={expandedOwnersId === connect.id}
                  providerName={
                    providers.find((item) => item.id === connect.provider)
                      ?.name ?? connect.provider
                  }
                  removing={removingId === connect.id}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border/70 px-4 py-10 text-center">
              <Cable className="mx-auto h-5 w-5 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">
                {t("options.connect.dsh.empty")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("options.connect.dsh.emptyDescription")}
              </p>
            </div>
          )}
        </PageContent>
      </ScrollArea>

      <CreateConnectDialog
        adapter={adapter}
        onCreated={() => {
          setAdding(false);
          void refresh();
        }}
        onOpenChange={setAdding}
        open={adding}
        providers={providers}
      />
    </div>
  );
}

function ConnectStatusBadge({ status }: { status: ConnectorStatus }) {
  const { t } = useT();
  if (status.state === "ready") {
    return <Badge variant="default">{t("options.connect.dsh.status.ready")}</Badge>;
  }
  if (status.state === "connecting") {
    return (
      <Badge variant="secondary">
        {t("options.connect.dsh.status.connecting")}
      </Badge>
    );
  }
  return (
    <Badge variant="destructive">
      {t("options.connect.dsh.status.error", { detail: status.detail })}
    </Badge>
  );
}

function ConnectRow({
  busy,
  connect,
  onAddOwner,
  onCancelRemove,
  onConfirmRemove,
  onOwnerDraftChange,
  onRemoveOwner,
  onStartRemove,
  onToggleEnabled,
  onToggleOwners,
  ownerDraft,
  ownersExpanded,
  providerName,
  removing,
}: {
  busy: boolean;
  connect: ConnectView;
  onAddOwner(): void;
  onCancelRemove(): void;
  onConfirmRemove(): void;
  onOwnerDraftChange(value: string): void;
  onRemoveOwner(owner: string): void;
  onStartRemove(): void;
  onToggleEnabled(): void;
  onToggleOwners(): void;
  ownerDraft: string;
  ownersExpanded: boolean;
  providerName: string;
  removing: boolean;
}) {
  const { t } = useT();
  return (
    <article className="overflow-hidden rounded-xl border border-border/65 bg-background">
      <div className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-border/60 bg-muted/30 text-muted-foreground">
          <Cable className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{connect.name}</span>
            <ConnectStatusBadge status={connect.status} />
          </span>
          <span className="mt-1 block truncate text-[11px] text-muted-foreground">
            {providerName}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          {removing ? (
            <>
              <span className="text-[11px] text-destructive">
                {t("options.connect.dsh.confirmRemove")}
              </span>
              <Button
                disabled={busy}
                onClick={onConfirmRemove}
                size="sm"
                variant="destructive"
              >
                {busy ? <Loader2 className="animate-spin" /> : <Check />}
                {t("options.connect.dsh.confirmRemoveAction")}
              </Button>
              <Button
                disabled={busy}
                onClick={onCancelRemove}
                size="sm"
                variant="ghost"
              >
                {t("options.connect.dsh.cancel")}
              </Button>
            </>
          ) : (
            <>
              <Button
                disabled={busy}
                onClick={onToggleEnabled}
                size="sm"
                variant="ghost"
              >
                {connect.enabled
                  ? t("options.connect.dsh.disable")
                  : t("options.connect.dsh.enable")}
              </Button>
              <Button onClick={onToggleOwners} size="sm" variant="ghost">
                <Users className="h-3.5 w-3.5" />
                {t("options.connect.dsh.owners", {
                  count: connect.owners.length,
                })}
              </Button>
              <Button
                className="text-destructive hover:text-destructive"
                disabled={busy}
                onClick={onStartRemove}
                size="sm"
                variant="ghost"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("options.connect.dsh.remove")}
              </Button>
            </>
          )}
        </span>
      </div>
      {ownersExpanded ? (
        <div className="space-y-2 border-t border-border/45 bg-muted/10 px-4 py-3">
          <p className="text-[10px] leading-4 text-muted-foreground">
            {t("options.connect.dsh.pairingExplanation")}
          </p>
          <ul className="space-y-1">
            {connect.owners.length ? (
              connect.owners.map((owner) => (
                <li
                  className="flex items-center justify-between gap-2 text-xs"
                  key={owner}
                >
                  <span className="min-w-0 truncate">{owner}</span>
                  <button
                    aria-label={t("options.connect.dsh.ownersRemove", {
                      owner,
                    })}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => onRemoveOwner(owner)}
                    type="button"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))
            ) : (
              <li className="text-[10px] text-muted-foreground">
                {t("options.connect.dsh.ownersEmpty")}
              </li>
            )}
          </ul>
          <div className="flex items-center gap-2">
            <Input
              onChange={(event) => onOwnerDraftChange(event.target.value)}
              placeholder={t("options.connect.dsh.ownersAddPlaceholder")}
              value={ownerDraft}
            />
            <Button
              disabled={!ownerDraft.trim()}
              onClick={onAddOwner}
              size="sm"
            >
              {t("options.connect.dsh.ownersAdd")}
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

const LARK_PROVIDER_ID = "lark";

function parseJsonConfig(
  text: string,
): { ok: true; value: Record<string, unknown> } | { ok: false } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: {} };
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false };
  }
}

function CreateConnectDialog({
  adapter,
  onCreated,
  onOpenChange,
  open,
  providers,
}: {
  adapter: ConnectAdapter;
  onCreated(): void;
  onOpenChange(open: boolean): void;
  open: boolean;
  providers: ConnectorProviderView[];
}) {
  const { t } = useT();
  const [provider, setProvider] = useState("");
  const [name, setName] = useState("");
  const [agentPreset, setAgentPreset] = useState("restricted");
  const [larkAppId, setLarkAppId] = useState("");
  const [larkAppSecret, setLarkAppSecret] = useState("");
  const [larkDomain, setLarkDomain] = useState("feishu");
  const [configText, setConfigText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProvider(providers[0]?.id ?? "");
    setName("");
    setAgentPreset("restricted");
    setLarkAppId("");
    setLarkAppSecret("");
    setLarkDomain("feishu");
    setConfigText("");
    setError(null);
  }, [open, providers]);

  const isLark = provider === LARK_PROVIDER_ID;
  const jsonResult = useMemo(
    () => (isLark ? { ok: true as const, value: {} } : parseJsonConfig(configText)),
    [configText, isLark],
  );

  async function submit() {
    if (!provider || !name.trim() || !agentPreset.trim()) return;
    let config: Record<string, unknown>;
    if (isLark) {
      if (!larkAppId.trim() || !larkAppSecret.trim()) return;
      config = {
        appId: larkAppId.trim(),
        appSecret: larkAppSecret,
        domain: larkDomain,
      };
    } else {
      if (!jsonResult.ok) return;
      config = jsonResult.value;
    }
    const input: CreateConnectInput = {
      provider,
      name: name.trim(),
      agentPreset: agentPreset.trim(),
      config,
    };
    setSaving(true);
    setError(null);
    try {
      await adapter.create(input);
      onCreated();
    } catch (cause) {
      setError(describeError(t, cause));
    } finally {
      setSaving(false);
    }
  }

  const canSubmit =
    Boolean(provider) &&
    Boolean(name.trim()) &&
    Boolean(agentPreset.trim()) &&
    (isLark
      ? Boolean(larkAppId.trim()) && Boolean(larkAppSecret.trim())
      : jsonResult.ok);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{t("options.connect.dsh.add")}</DialogTitle>
        <DialogDescription>
          {t("options.connect.dsh.addDescription")}
        </DialogDescription>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="dsh-connect-provider">
              {t("options.connect.dsh.provider")}
            </Label>
            <Select
              disabled={providers.length === 0}
              onValueChange={setProvider}
              value={provider}
            >
              <SelectTrigger id="dsh-connect-provider">
                <SelectValue
                  placeholder={t("options.connect.dsh.selectProvider")}
                />
              </SelectTrigger>
              <SelectContent>
                {providers.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {providers.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                {t("options.connect.dsh.noProviders")}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dsh-connect-name">
              {t("options.connect.dsh.name")}
            </Label>
            <Input
              id="dsh-connect-name"
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dsh-connect-agent-preset">
              {t("options.connect.dsh.agentPreset")}
            </Label>
            <Input
              id="dsh-connect-agent-preset"
              onChange={(event) => setAgentPreset(event.target.value)}
              value={agentPreset}
            />
          </div>
          {isLark ? (
            <div className="space-y-3 rounded-xl border border-border/55 p-3">
              <div className="space-y-1.5">
                <Label htmlFor="dsh-connect-lark-app-id">
                  {t("options.connect.dsh.lark.appId")}
                </Label>
                <Input
                  id="dsh-connect-lark-app-id"
                  onChange={(event) => setLarkAppId(event.target.value)}
                  value={larkAppId}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dsh-connect-lark-app-secret">
                  {t("options.connect.dsh.lark.appSecret")}
                </Label>
                <Input
                  id="dsh-connect-lark-app-secret"
                  onChange={(event) => setLarkAppSecret(event.target.value)}
                  type="password"
                  value={larkAppSecret}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dsh-connect-lark-domain">
                  {t("options.connect.dsh.lark.domain")}
                </Label>
                <Select onValueChange={setLarkDomain} value={larkDomain}>
                  <SelectTrigger id="dsh-connect-lark-domain">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="feishu">Feishu</SelectItem>
                    <SelectItem value="lark">Lark</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="dsh-connect-config">
                {t("options.connect.dsh.config")}
              </Label>
              <Textarea
                className={cn(!jsonResult.ok && "border-destructive")}
                id="dsh-connect-config"
                onChange={(event) => setConfigText(event.target.value)}
                placeholder="{}"
                rows={4}
                value={configText}
              />
              <p className="text-[11px] text-muted-foreground">
                {t("options.connect.dsh.configJsonHint")}
              </p>
              {!jsonResult.ok ? (
                <p className="text-xs text-destructive">
                  {t("options.connect.dsh.configJsonError")}
                </p>
              ) : null}
            </div>
          )}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button onClick={() => onOpenChange(false)} variant="ghost">
              {t("options.connect.dsh.cancel")}
            </Button>
            <Button disabled={saving || !canSubmit} onClick={() => void submit()}>
              {saving ? <Loader2 className="animate-spin" /> : <Plus />}
              {t("options.connect.dsh.submit")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
