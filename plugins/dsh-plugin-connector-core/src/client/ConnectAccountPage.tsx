import { DesktopSyncSettings } from "./DesktopSyncSettings.js";
import { ArrowLeft, ChevronRight, Loader2, Power, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, Input, Label, usePluginT } from "@amiba/ui/plugin";
import type {
  ConnectDetails,
  ConnectorProviderView,
  ConnectView,
} from "../types.js";
import type { ConnectAdapter } from "./adapter.js";
import type { MessageConversationSettingsInput } from "../remote.js";
import type {
  ConnectorUIContribution,
  PresetOption,
} from "./connector-ui-registry.js";
import { BasicsFields } from "./wizard-kit.js";
import { DetailStatus } from "./ConnectorDetailPage.js";
import { connectI18n } from "./i18n.js";
import { describeError } from "./describe-error.js";

export function ConnectAccountPage({
  adapter,
  connect,
  entry,
  provider,
  presets,
  onBack,
  onChanged,
  onRemoved,
  accessPanel,
}: {
  adapter: ConnectAdapter;
  connect: ConnectView;
  entry?: ConnectorUIContribution;
  provider?: ConnectorProviderView;
  presets: PresetOption[];
  onBack(): void;
  onChanged(): Promise<void>;
  onRemoved(): void;
  accessPanel?: import("react").ReactNode;
}) {
  const { t } = usePluginT(connectI18n);
  const [details, setDetails] = useState<ConnectDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [name, setName] = useState(connect.name);
  const [preset, setPreset] = useState(connect.agentPreset ?? "");
  const [owners, setOwners] = useState(connect.owners.join(", "));
  const [nothingToRetry, setNothingToRetry] = useState(false);
  const Settings = entry?.settings;
  const refresh = useCallback(async () => {
    setDetails(await adapter.details(connect.id));
  }, [adapter, connect.id]);
  const manageConversation = useCallback((key: string, input: MessageConversationSettingsInput) => {
    if (!adapter.conversationSettings) return Promise.reject(new Error("conversation_owner_unavailable"));
    return adapter.conversationSettings(connect.id, key, input);
  }, [adapter, connect.id]);
  const searchResources = useCallback((key: string, query: string) => {
    if (!adapter.searchConversationResources) return Promise.reject(new Error("resource_source_unavailable"));
    return adapter.searchConversationResources(connect.id, key, query);
  }, [adapter, connect.id]);
  const shareResources = useCallback((key: string, references: string[]) => {
    if (!adapter.shareConversationResources) return Promise.reject(new Error("resource_source_unavailable"));
    return adapter.shareConversationResources(connect.id, key, references);
  }, [adapter, connect.id]);
  useEffect(() => {
    let active = true;
    void adapter.details(connect.id).then(
      (value) => {
        if (active) setDetails(value);
      },
      (cause) => {
        if (active) setError(describeError(t, cause));
      },
    );
    return () => {
      active = false;
    };
  }, [adapter, connect.id, t]);

  async function run(operation: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await operation();
      // A successful credential change stays successful even if the follow-up
      // refresh fails; the provider must still be able to show the issued token.
      const refreshed = await Promise.allSettled([refresh(), onChanged()]);
      for (const result of refreshed) {
        if (result.status === "rejected")
          setError(describeError(t, result.reason));
      }
    } catch (cause) {
      setError(describeError(t, cause));
      throw cause;
    } finally {
      setBusy(false);
    }
  }
  const act = (operation: () => Promise<unknown>) => {
    void run(operation).catch(() => undefined);
  };
  const preview = async (action: "remove" | "disable") => {
    setBusy(true);
    setError(null);
    try {
      setDetails(await adapter.details(connect.id));
      if (action === "remove") setRemoving(true);
      else setDisabling(true);
    } catch (cause) {
      setError(describeError(t, cause));
    } finally {
      setBusy(false);
    }
  };
  const impact = details?.capabilityUses?.length ? (
    <div className="space-y-1 text-sm">
      <p>{t("options.connect.dsh.account.affected")}</p>
      <ul className="space-y-1 text-muted-foreground">
        {details.capabilityUses.map((use, index) => (
          <li key={`${use.name}-${index}`}>
            <span className="font-medium">{use.name}</span> ·{" "}
            {use.capabilities.join("、")}
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  const basics = (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        act(() => adapter.update(connect.id, { name, agentPreset: preset }));
      }}
    >
      <BasicsFields
        name={name}
        onNameChange={setName}
        preset={preset}
        onPresetChange={setPreset}
        presets={presets}
      />
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {t("options.connect.dsh.account.presetHint")}
        </p>
        <Button
          type="submit"
          disabled={
            busy ||
            !name.trim() ||
            !preset ||
            (name === connect.name && preset === connect.agentPreset)
          }
        >
          {t("options.connect.dsh.account.save")}
        </Button>
      </div>
    </form>
  );
  return (
    <div className="max-w-3xl space-y-8" data-connect-account={connect.id}>
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 text-muted-foreground"
        onClick={onBack}
      >
        <ArrowLeft />
        {provider?.name ?? t("options.connect.dsh.detail.back")}
      </Button>
      <header className="flex items-center gap-4">
        {entry?.icon ? (
          <span className="h-12 w-12 shrink-0 [&>svg]:h-full [&>svg]:w-full [&>img]:h-full [&>img]:w-full">
            {entry.icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {connect.name}
          </h1>
          <div className="mt-1">
            <DetailStatus status={connect.status} />
          </div>
        </div>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            connect.enabled
              ? void preview("disable")
              : act(() => adapter.setEnabled(connect.id, true))
          }
        >
          <Power />
          {t(
            connect.enabled
              ? "options.connect.dsh.disable"
              : "options.connect.dsh.enable",
          )}
        </Button>
      </header>
      {disabling ? (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <p className="text-sm">
            {t("options.connect.dsh.account.disableHint")}
          </p>
          {impact}
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setDisabling(false)}
            >
              {t("options.connect.dsh.cancel")}
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await adapter.setEnabled(connect.id, false);
                  setDisabling(false);
                })
              }
            >
              {t("options.connect.dsh.disable")}
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!entry?.settingsFirst && basics}
      {!entry?.settingsFirst && accessPanel}
      {!details ? (
        <Loader2
          className="h-4 w-4 animate-spin text-muted-foreground"
          aria-label={t("options.connect.dsh.loading")}
        />
      ) : (
        <>
          {adapter.conversationSettings && details.messaging?.conversations.map(item => (
            <DesktopSyncSettings key={item.key} adapter={adapter} connectId={connect.id} conversationKey={item.key} target={`${connect.name} · ${item.title || t("options.connect.dsh.account.conversations")}`} />
          ))}
          {Settings ? (
            <Settings
              host={{
                connect,
                settings: details.settings,
                ...(details.messaging && adapter.conversationSettings ? { conversations: { items: details.messaging.conversations, manage: manageConversation, refresh, searchResources, shareResources } } : {}),
                save: async (settings) => {
                  await run(() => adapter.update(connect.id, { settings }));
                },
              }}
            />
          ) : null}
          {entry?.settingsFirst && (
            <details className="space-y-4">
              <summary className="cursor-pointer text-sm text-muted-foreground">
                {t("options.connect.dsh.account.customize")}
              </summary>
              {basics}
              {accessPanel}
            </details>
          )}
          {provider?.messaging?.sharedConversations && details.messaging?.delivery.lastDeliveryError ? (
            <div className="space-y-2"><p role="status" className="text-sm text-destructive">{t("options.connect.dsh.account.deliveryFailed")}</p>
              {adapter.retryFailedReplies ? <Button variant="outline" size="sm" disabled={busy || !connect.enabled} onClick={() => act(async () => {
                setNothingToRetry(false);
                const result = await adapter.retryFailedReplies!(connect.id);
                setNothingToRetry(result.retried === 0);
              })}>{t("options.connect.dsh.account.retryReplies")}</Button> : null}
              {nothingToRetry ? <p role="status" className="text-sm text-muted-foreground">{t("options.connect.dsh.account.nothingToRetry")}</p> : null}
            </div>
          ) : null}
          {details.messaging ? (
            <details className="group space-y-5">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none"
                  aria-hidden="true"
                />
                {t(provider?.messaging?.sharedConversations ? "options.connect.dsh.account.diagnostics" : "options.connect.dsh.account.messaging")}
              </summary>
              {provider?.messaging?.ownerPairing && !provider.messaging.sharedConversations ? (
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    act(() =>
                      adapter.setOwners(
                        connect.id,
                        owners
                          .split(/[\n,]/u)
                          .map((value) => value.trim())
                          .filter(Boolean),
                      ),
                    );
                  }}
                >
                  <Label htmlFor="connect-owners">
                    {t("options.connect.dsh.account.owners")}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t(
                      connect.pairing
                        ? "options.connect.dsh.account.pairing"
                        : "options.connect.dsh.account.ownersHint",
                    )}
                  </p>
                  <Input
                    id="connect-owners"
                    value={owners}
                    onChange={(event) => setOwners(event.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    type="submit"
                    disabled={busy}
                  >
                    {t("options.connect.dsh.account.saveOwners")}
                  </Button>
                </form>
              ) : null}
              <section className="space-y-3">
                <h2 className="text-sm font-medium">
                  {t("options.connect.dsh.account.delivery")}
                </h2>
                <dl className="grid grid-cols-3 gap-4 text-sm">
                  {(
                    [
                      "pendingInbound",
                      "queuedOutbound",
                      "failedOutbound",
                    ] as const
                  ).map((key) => (
                    <div key={key}>
                      <dt className="text-muted-foreground">
                        {t(`options.connect.dsh.account.${key}`)}
                      </dt>
                      <dd className="mt-1 tabular-nums">
                        {details.messaging!.delivery[key]}
                      </dd>
                    </div>
                  ))}
                </dl>
                {details.messaging.delivery.lastDeliveryError ? (
                  <p className="break-words text-sm text-destructive">
                    {details.messaging.delivery.lastDeliveryError}
                  </p>
                ) : null}
              </section>
              <section className="space-y-3">
                <h2 className="text-sm font-medium">
                  {t("options.connect.dsh.account.conversations")}
                </h2>
                {details.messaging.conversations.length ? (
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {details.messaging.conversations.map((item) => (
                      <li
                        key={item.key}
                        className="flex flex-wrap justify-between gap-2"
                      >
                        <span>{item.title ?? item.key}</span>
                        <code className="break-all text-xs">
                          {item.sessionId}
                        </code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("options.connect.dsh.account.noConversations")}
                  </p>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => act(async () => undefined)}
                >
                  {t("options.connect.dsh.account.refresh")}
                </Button>
              </section>
            </details>
          ) : null}
        </>
      )}
      <div className="pt-2">
        {removing ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <div className="flex-1 space-y-3">
              <p>{t("options.connect.dsh.account.removeHint")}</p>
              {impact}
            </div>
            <Button
              variant="ghost"
              onClick={() => setRemoving(false)}
              disabled={busy}
            >
              {t("options.connect.dsh.account.keep")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await adapter.remove(connect.id);
                  await onChanged();
                  onRemoved();
                } catch (cause) {
                  setError(describeError(t, cause));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("options.connect.dsh.account.remove")}
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            className="-ml-3 text-muted-foreground hover:text-destructive"
            onClick={() => void preview("remove")}
            disabled={busy}
          >
            <Trash2 />
            {t("options.connect.dsh.account.remove")}
          </Button>
        )}
      </div>
    </div>
  );
}
