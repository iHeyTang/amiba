import {
  Cable,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Copy,
  KeyRound,
  Loader2,
  MessageCircleMore,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  Trash2,
  Webhook,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  AgentSessionsAdapter,
  AgentSessionSummary,
} from "@amiba/app-runtime/platform";
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
  cn,
  usePluginT as useT,
} from "@amiba/ui/plugin";

import type { MessageChannelView } from "../center.js";
import type {
  MessageCenterSnapshot,
  MessageChannelInput,
  MessageChannelPatch,
  MessageChannelSecret,
} from "../remote.js";

/** Client-facing messaging surface consumed by the settings section registration in `./index.tsx`. */
export interface MessagingAdapter {
  list(): Promise<MessageCenterSnapshot>;
  create(input: MessageChannelInput): Promise<MessageChannelSecret>;
  update(id: string, patch: MessageChannelPatch): Promise<MessageChannelView>;
  remove(id: string): Promise<{ id: string; deleted: boolean }>;
  rotateSecret(id: string): Promise<MessageChannelSecret>;
}

interface RevealedSecret {
  channel: MessageChannelView;
  secret: string;
}

export function DshSettingsMessaging({
  adapter,
  sessionsAdapter,
}: {
  adapter: MessagingAdapter;
  sessionsAdapter: Pick<AgentSessionsAdapter, "list">;
  /** Section-hosted head has no action buttons for this pane today; the
   *  prop is accepted for API parity with the other DSH section views. */
  headerActionsHost?: () => HTMLElement | null;
}) {
  const { t } = useT();
  const [snapshot, setSnapshot] = useState<MessageCenterSnapshot | null>(
    null,
  );
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingProvider, setAddingProvider] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<RevealedSecret | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [next, sessionItems] = await Promise.all([
        adapter.list(),
        sessionsAdapter.list(),
      ]);
      setSnapshot(next);
      setSessions(sessionItems.filter((item) => !item.origin));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [adapter, sessionsAdapter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function mutate(id: string, operation: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  }

  const filteredChannels = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return snapshot?.channels ?? [];
    return (snapshot?.channels ?? []).filter((channel) =>
      `${channel.name} ${channel.provider} ${channel.sessionId}`
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [query, snapshot?.channels]);
  const filteredProviders = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return snapshot?.providers ?? [];
    return (snapshot?.providers ?? []).filter((provider) =>
      `${provider.id} ${provider.name} ${provider.description}`
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [query, snapshot?.providers]);
  const channelGroups = [
    {
      id: "connected",
      title: t("options.messaging.dsh.group.configured"),
      description: t("options.messaging.dsh.group.configuredDescription"),
      items: filteredChannels,
    },
  ];
  const selected =
    snapshot?.channels.find((channel) => channel.id === selectedId) ?? null;
  const connectedCount =
    snapshot?.channels.filter((channel) => channel.enabled).length ?? 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <PageContent bodyClassName="space-y-4" className="pt-3" size="md">
          <SettingsPageDescription>
            {t("options.messaging.dsh.description")}
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

          <section className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/15 px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <MessageCircleMore className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {connectedCount
                  ? t("options.messaging.dsh.summary.connected", {
                      connected: connectedCount,
                      total: snapshot?.channels.length ?? 0,
                    })
                  : t("options.messaging.dsh.summary.none")}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    snapshot
                      ? "bg-[hsl(var(--success))]"
                      : "bg-muted-foreground/45",
                  )}
                />
                {t("options.messaging.dsh.pluginTitle")}
                <span aria-hidden>·</span>
                <span>
                  {t("options.messaging.dsh.providerCount", {
                    count: snapshot?.providers.length ?? 0,
                  })}
                </span>
              </p>
            </div>
            <Button
              aria-label={t("common.refresh")}
              disabled={loading}
              onClick={() => void refresh()}
              size="icon"
              variant="ghost"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </section>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/65" />
            <Input
              aria-label={t("options.messaging.dsh.search")}
              className="pl-9"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("options.messaging.dsh.search")}
              type="search"
              value={query}
            />
          </div>

          <div className="space-y-6">
            {channelGroups.map((group) =>
              group.items.length ? (
                <section className="space-y-2.5" key={group.id}>
                  <div className="flex items-end justify-between gap-3 px-1">
                    <div className="min-w-0">
                      <h2 className="text-xs font-semibold text-foreground">
                        {group.title}
                        <span className="ml-2 font-normal text-muted-foreground">
                          {group.items.length}
                        </span>
                      </h2>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {group.description}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {group.items.map((channel) => (
                      <ChannelCard
                        channel={channel}
                        key={channel.id}
                        onOpen={() => setSelectedId(channel.id)}
                        providerName={
                          snapshot?.providers.find(
                            (provider) => provider.id === channel.provider,
                          )?.name ?? channel.provider
                        }
                      />
                    ))}
                  </div>
                </section>
              ) : null,
            )}

            {filteredProviders.length ? (
              <section className="space-y-2.5">
                <div className="flex items-end justify-between gap-3 px-1">
                  <div className="min-w-0">
                    <h2 className="text-xs font-semibold text-foreground">
                      {t("options.messaging.dsh.group.available")}
                      <span className="ml-2 font-normal text-muted-foreground">
                        {filteredProviders.length}
                      </span>
                    </h2>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {t("options.messaging.dsh.group.availableDescription")}
                    </p>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {filteredProviders.map((provider) => (
                    <article
                      className="overflow-hidden rounded-xl border border-border/65 bg-background"
                      key={provider.id}
                    >
                      <button
                        aria-label={t("options.messaging.dsh.configure", {
                          name: provider.name,
                        })}
                        className="grid min-h-24 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/25 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={!sessions.length}
                        onClick={() => setAddingProvider(provider.id)}
                        type="button"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-border/60 bg-muted/30 text-muted-foreground">
                          <Webhook className="h-[18px] w-[18px]" />
                        </span>
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">
                              {provider.name}
                            </span>
                            <Badge className="shrink-0" variant="secondary">
                              <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/55" />
                              {t("options.messaging.dsh.needsSetup")}
                            </Badge>
                          </span>
                          <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                            {provider.description}
                          </span>
                        </span>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="hidden sm:inline">
                            {t("options.messaging.dsh.setup")}
                          </span>
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted/45">
                            <ChevronRight className="h-3.5 w-3.5" />
                          </span>
                        </span>
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {loading && !snapshot ? (
              <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 px-4 py-10 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("common.loading")}
              </div>
            ) : !loading &&
              filteredChannels.length === 0 &&
              filteredProviders.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 px-4 py-10 text-center">
                <Webhook className="mx-auto h-5 w-5 text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">
                  {query
                    ? t("options.messaging.dsh.searchEmpty")
                    : t("options.messaging.dsh.empty")}
                </p>
                {!query ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("options.messaging.dsh.emptyDescription")}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          {snapshot ? (
            <section className="rounded-xl border border-border/55 p-4">
              <Label>{t("options.messaging.dsh.inboundEndpoint")}</Label>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-muted/55 px-3 py-2 text-[11px]">
                  {snapshot.inboundEndpoint}
                </code>
                <CopyButton value={snapshot.inboundEndpoint} />
              </div>
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                {t("options.messaging.dsh.loopbackHint")}
              </p>
            </section>
          ) : null}
        </PageContent>
      </ScrollArea>

      <CreateChannelDialog
        adapter={adapter}
        open={addingProvider !== null}
        initialProvider={addingProvider ?? undefined}
        providers={snapshot?.providers ?? []}
        sessions={sessions}
        onOpenChange={(open) => {
          if (!open) setAddingProvider(null);
        }}
        onCreated={(value) => {
          setRevealed(value);
          setAddingProvider(null);
          void refresh();
        }}
      />
      <ChannelEditorDialog
        busy={Boolean(selected && busyId === selected.id)}
        channel={selected}
        sessions={sessions}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        onRemove={(channel) =>
          void mutate(channel.id, async () => {
            await adapter.remove(channel.id);
            setSelectedId(null);
          })
        }
        onRotate={(channel) =>
          void mutate(channel.id, async () => {
            const result = await adapter.rotateSecret(channel.id);
            setRevealed(result);
          })
        }
        onSave={(channel, patch) =>
          void mutate(channel.id, () => adapter.update(channel.id, patch))
        }
      />
      <SecretDialog
        endpoint={snapshot?.inboundEndpoint ?? ""}
        value={revealed}
        onClose={() => setRevealed(null)}
      />
    </div>
  );
}

function ChannelCard({
  channel,
  onOpen,
  providerName,
}: {
  channel: MessageChannelView;
  onOpen(): void;
  providerName: string;
}) {
  const { t } = useT();
  // Older messaging snapshots did not include delivery counters. Keep
  // the settings surface readable while the next refresh upgrades the shape.
  const delivery = channel.delivery ?? {
    pendingInbound: 0,
    queuedOutbound: 0,
    failedOutbound: 0,
  };
  return (
    <article className="overflow-hidden rounded-xl border border-border/65 bg-background">
      <button
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/25"
        onClick={onOpen}
        type="button"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-border/60 bg-muted/30 text-muted-foreground">
          <Webhook className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{channel.name}</span>
            <Badge variant={channel.enabled ? "success" : "secondary"}>
              <span
                className={cn(
                  "mr-1.5 h-1.5 w-1.5 rounded-full",
                  channel.enabled
                    ? "bg-[hsl(var(--success))]"
                    : "bg-muted-foreground/55",
                )}
              />
              {channel.enabled
                ? t("options.messaging.status.connected")
                : t("options.messaging.status.disabled")}
            </Badge>
          </span>
          <span className="mt-1 block truncate text-[11px] text-muted-foreground">
            <span>{providerName}</span>
            <span aria-hidden> · </span>
            <span>{channel.sessionId}</span>
          </span>
          {delivery.pendingInbound ||
          delivery.queuedOutbound ||
          delivery.failedOutbound ? (
            <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
              {delivery.pendingInbound ? (
                <span>
                  {t("options.messaging.dsh.pending", {
                    count: delivery.pendingInbound,
                  })}
                </span>
              ) : null}
              {delivery.queuedOutbound ? (
                <span>
                  {t("options.messaging.dsh.queued", {
                    count: delivery.queuedOutbound,
                  })}
                </span>
              ) : null}
              {delivery.failedOutbound ? (
                <span
                  className="text-destructive"
                  title={delivery.lastDeliveryError}
                >
                  {t("options.messaging.dsh.failed", {
                    count: delivery.failedOutbound,
                  })}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="hidden sm:inline">
            {t("options.messaging.dsh.manage")}
          </span>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted/45">
            <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </span>
      </button>
    </article>
  );
}

function ChannelEditorDialog({
  busy,
  channel,
  sessions,
  onOpenChange,
  onRemove,
  onRotate,
  onSave,
}: {
  busy: boolean;
  channel: MessageChannelView | null;
  sessions: AgentSessionSummary[];
  onOpenChange(open: boolean): void;
  onRemove(channel: MessageChannelView): void;
  onRotate(channel: MessageChannelView): void;
  onSave(channel: MessageChannelView, patch: MessageChannelPatch): void;
}) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [outboundUrl, setOutboundUrl] = useState("");
  const [allowedSenders, setAllowedSenders] = useState("");

  useEffect(() => {
    if (!channel) return;
    setName(channel.name);
    setSessionId(channel.sessionId);
    setOutboundUrl(channel.outboundUrl ?? "");
    setAllowedSenders(channel.allowedSenders.join(", "));
  }, [channel]);

  if (!channel) return <Dialog onOpenChange={onOpenChange} open={false} />;

  const senderList = allowedSenders
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const dirty =
    name.trim() !== channel.name ||
    sessionId !== channel.sessionId ||
    outboundUrl.trim() !== (channel.outboundUrl ?? "") ||
    senderList.join("\u0000") !== channel.allowedSenders.join("\u0000");
  const delivery = channel.delivery ?? {
    pendingInbound: 0,
    queuedOutbound: 0,
    failedOutbound: 0,
  };

  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent
        className="flex max-h-[calc(100vh-3rem)] flex-col gap-0 overflow-hidden p-0"
        size="lg"
      >
        <header className="flex items-start gap-3 border-b border-border/55 px-5 py-4 pr-12">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-border/60 bg-muted/30 text-muted-foreground">
            <Webhook className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle className="text-base">{channel.name}</DialogTitle>
              <Badge variant={channel.enabled ? "success" : "secondary"}>
                <span
                  className={cn(
                    "mr-1.5 h-1.5 w-1.5 rounded-full",
                    channel.enabled
                      ? "bg-[hsl(var(--success))]"
                      : "bg-muted-foreground/55",
                  )}
                />
                {channel.enabled
                  ? t("options.messaging.status.connected")
                  : t("options.messaging.status.disabled")}
              </Badge>
            </div>
            <DialogDescription className="mt-1 text-xs leading-5">
              {t("options.messaging.dsh.createDescription")}
            </DialogDescription>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/10 px-5 py-4">
          <div className="mx-auto max-w-[640px] space-y-4">
            <ol className="grid gap-px overflow-hidden rounded-xl border border-border/55 bg-border/55 sm:grid-cols-2">
              {[
                {
                  label: t("options.messaging.dsh.provider"),
                  value: channel.provider,
                  complete: true,
                },
                {
                  label: t("options.messaging.dsh.session"),
                  value: channel.sessionId,
                  complete: Boolean(channel.sessionId),
                },
                {
                  label: t("options.messaging.dsh.allowedSenders"),
                  value: channel.allowedSenders.length
                    ? channel.allowedSenders.join(", ")
                    : "—",
                  complete: channel.allowedSenders.length > 0,
                },
                {
                  label: t("options.messaging.dsh.outboundUrl"),
                  value: channel.outboundUrl ?? "—",
                  complete: Boolean(channel.outboundUrl),
                },
              ].map((step, index) => (
                <li
                  className="flex min-w-0 gap-2.5 bg-background px-3 py-2.5"
                  key={step.label}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium",
                      step.complete
                        ? "border-[hsl(var(--success))]/35 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]"
                        : "border-border bg-background text-muted-foreground",
                    )}
                  >
                    {step.complete ? <Check className="h-3 w-3" /> : index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[11px] font-medium">
                      {step.label}
                    </span>
                    <span
                      className="mt-0.5 block truncate text-[9.5px] leading-4 text-muted-foreground"
                      title={step.value}
                    >
                      {step.value}
                    </span>
                  </span>
                </li>
              ))}
            </ol>

            <section className="space-y-4 rounded-xl border border-border/55 bg-background p-4">
              <div>
                <h3 className="text-xs font-semibold">
                  {t("options.messaging.dsh.channels")}
                </h3>
                <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                  {t("options.messaging.dsh.channelsDescription")}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="dsh-channel-name">
                  {t("options.messaging.dsh.name")}
                </Label>
                <Input
                  id="dsh-channel-name"
                  onChange={(event) => setName(event.target.value)}
                  value={name}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="dsh-channel-session">
                  {t("options.messaging.dsh.session")}
                </Label>
                <Select onValueChange={setSessionId} value={sessionId}>
                  <SelectTrigger id="dsh-channel-session">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sessions.map((session) => (
                      <SelectItem
                        key={session.sessionId}
                        value={session.sessionId}
                      >
                        {session.title || session.sessionId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </section>

            <section className="space-y-3 rounded-xl border border-border/55 bg-background p-4">
              <div>
                <h3 className="text-xs font-semibold">
                  {t("options.messaging.dsh.allowedSenders")}
                </h3>
                <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                  {t("options.messaging.dsh.pluginDescription")}
                </p>
              </div>
              <Input
                onChange={(event) => setAllowedSenders(event.target.value)}
                value={allowedSenders}
              />
            </section>

            <section className="space-y-3 rounded-xl border border-border/55 bg-background p-4">
              <div>
                <h3 className="text-xs font-semibold">
                  {t("options.messaging.dsh.outboundUrl")}
                </h3>
                <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                  {t("options.messaging.dsh.loopbackHint")}
                </p>
              </div>
              <Input
                onChange={(event) => setOutboundUrl(event.target.value)}
                placeholder="https://example.com/amiba-replies"
                value={outboundUrl}
              />
            </section>

            <details className="group rounded-xl border border-border/55 bg-background">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-xs font-semibold">
                <Cable className="h-3.5 w-3.5 text-muted-foreground" />
                {t("options.status.dsh.runtime")}
                <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
              </summary>
              <div className="grid gap-2 border-t border-border/45 px-4 py-4 text-[10px] text-muted-foreground sm:grid-cols-2">
                <span className="font-mono">{channel.id}</span>
                <span>{new Date(channel.updatedAt).toLocaleString()}</span>
                <span>
                  {t("options.messaging.dsh.pending", {
                    count: delivery.pendingInbound,
                  })}
                </span>
                <span>
                  {t("options.messaging.dsh.queued", {
                    count: delivery.queuedOutbound,
                  })}
                </span>
                {delivery.failedOutbound ? (
                  <span
                    className="text-destructive"
                    title={delivery.lastDeliveryError}
                  >
                    {t("options.messaging.dsh.failed", {
                      count: delivery.failedOutbound,
                    })}
                  </span>
                ) : null}
              </div>
            </details>
          </div>
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-border/55 bg-background px-5 py-3">
          <Button
            className="mr-auto text-destructive hover:text-destructive"
            disabled={busy}
            onClick={() => onRemove(channel)}
            size="sm"
            variant="ghost"
          >
            <Trash2 />
            {t("common.delete")}
          </Button>
          <Button
            disabled={busy}
            onClick={() => onRotate(channel)}
            size="sm"
            variant="outline"
          >
            <RotateCw />
            {t("options.messaging.dsh.rotate")}
          </Button>
          <Button
            disabled={busy}
            onClick={() => onSave(channel, { enabled: !channel.enabled })}
            size="sm"
            variant="ghost"
          >
            {channel.enabled
              ? t("options.messaging.dsh.disable")
              : t("options.messaging.dsh.enable")}
          </Button>
          <Button
            disabled={busy || !dirty || !name.trim() || !sessionId}
            onClick={() =>
              onSave(channel, {
                name: name.trim(),
                sessionId,
                outboundUrl: outboundUrl.trim(),
                allowedSenders: senderList,
              })
            }
            size="sm"
          >
            {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
            {t("options.messaging.dsh.saveChanges")}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function CreateChannelDialog({
  adapter,
  open,
  onOpenChange,
  initialProvider,
  providers,
  sessions,
  onCreated,
}: {
  adapter: MessagingAdapter;
  open: boolean;
  onOpenChange(value: boolean): void;
  initialProvider?: string;
  providers: MessageCenterSnapshot["providers"];
  sessions: AgentSessionSummary[];
  onCreated(value: RevealedSecret): void;
}) {
  const { t } = useT();
  const [provider, setProvider] = useState("webhook");
  const [name, setName] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [outboundUrl, setOutboundUrl] = useState("");
  const [allowedSenders, setAllowedSenders] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedProvider = useMemo(
    () => providers.find((item) => item.id === provider),
    [provider, providers],
  );

  useEffect(() => {
    if (!open) return;
    setProvider(initialProvider ?? providers[0]?.id ?? "webhook");
    setSessionId((current) =>
      sessions.some((session) => session.sessionId === current)
        ? current
        : (sessions[0]?.sessionId ?? ""),
    );
  }, [initialProvider, open, providers, sessions]);

  async function create() {
    if (!name.trim() || !sessionId) return;
    setSaving(true);
    setError(null);
    try {
      onCreated(
        await adapter.create({
          provider,
          name: name.trim(),
          sessionId,
          ...(outboundUrl.trim() ? { outboundUrl: outboundUrl.trim() } : {}),
          ...(allowedSenders.trim()
            ? {
                allowedSenders: allowedSenders
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean),
              }
            : {}),
        }),
      );
      setName("");
      setOutboundUrl("");
      setAllowedSenders("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{t("options.messaging.dsh.add")}</DialogTitle>
        <DialogDescription>
          {t("options.messaging.dsh.createDescription")}
        </DialogDescription>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label>{t("options.messaging.dsh.provider")}</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providers.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedProvider ? (
              <p className="text-[11px] text-muted-foreground">
                {selectedProvider.description}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label>{t("options.messaging.dsh.name")}</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("options.messaging.dsh.session")}</Label>
            <Select value={sessionId} onValueChange={setSessionId}>
              <SelectTrigger>
                <SelectValue
                  placeholder={t("options.messaging.dsh.selectSession")}
                />
              </SelectTrigger>
              <SelectContent>
                {sessions.map((session) => (
                  <SelectItem key={session.sessionId} value={session.sessionId}>
                    {session.title || session.sessionId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("options.messaging.dsh.outboundUrl")}</Label>
            <Input
              placeholder="https://example.com/amiba-replies"
              value={outboundUrl}
              onChange={(event) => setOutboundUrl(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("options.messaging.dsh.allowedSenders")}</Label>
            <Input
              placeholder="github, deploy-bot"
              value={allowedSenders}
              onChange={(event) => setAllowedSenders(event.target.value)}
            />
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button onClick={() => onOpenChange(false)} variant="ghost">
              {t("common.cancel")}
            </Button>
            <Button
              disabled={saving || !name.trim() || !sessionId}
              onClick={() => void create()}
            >
              {saving ? <Loader2 className="animate-spin" /> : <Plus />}
              {t("common.add")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SecretDialog({
  value,
  endpoint,
  onClose,
}: {
  value: RevealedSecret | null;
  endpoint: string;
  onClose(): void;
}) {
  const { t } = useT();
  const example = value
    ? `curl -X POST ${JSON.stringify(endpoint)} -H 'Content-Type: application/json' -H 'Authorization: Bearer ${value.secret}' -d '${JSON.stringify({ channelId: value.channel.id, id: "event-1", sender: "service", text: "Describe this event" })}'`
    : "";
  return (
    <Dialog
      open={Boolean(value)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4" />
          {t("options.messaging.dsh.secretTitle")}
        </DialogTitle>
        <DialogDescription>
          {t("options.messaging.dsh.secretDescription")}
        </DialogDescription>
        {value ? (
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg bg-muted/60 px-3 py-2 text-xs">
                {value.secret}
              </code>
              <CopyButton value={value.secret} />
            </div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-muted/55 p-3 text-[10px] leading-4">
              {example}
            </pre>
            <div className="flex justify-end">
              <Button onClick={onClose}>
                <Check />
                {t("common.confirm")}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CopyButton({ value }: { value: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      aria-label={t("common.copy")}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1_500);
        });
      }}
      size="icon"
      variant="ghost"
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
}
