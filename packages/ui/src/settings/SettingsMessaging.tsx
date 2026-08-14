import {
  approveHermesPairing,
  createHermesWebhook,
  deleteHermesWebhook,
  getHermesMessagingPlatforms,
  getHermesPairings,
  getHermesWebhooks,
  revokeHermesPairing,
  restartHermesGateway,
  saveHermesMessagingPlatform,
  setHermesWebhookEnabled,
  testHermesMessagingPlatform,
  updateHermesWebhook,
  type HermesMessagingField,
  type HermesMessagingPlatform,
  type HermesWebhookSubscription,
} from "@amiba/core";
import { useT, type MessageKey, type ResolvedLanguage } from "@amiba/i18n";
import {
  ArrowUpRight,
  Cable,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDashed,
  ExternalLink,
  MessageCircleMore,
  Plus,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  Webhook,
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
  Switch,
  cn,
} from "../primitives";
import { MessagingChannelIcon } from "./MessagingChannelIcon";
import { SettingsPaneHeader } from "./SettingsPaneHeader";

type Tab = "channels" | "pairing" | "webhooks";

const PLATFORM_DESCRIPTION_KEYS: Partial<Record<string, MessageKey>> = {
  telegram: "options.messaging.platform.telegram",
  discord: "options.messaging.platform.discord",
  slack: "options.messaging.platform.slack",
  whatsapp: "options.messaging.platform.whatsapp",
  signal: "options.messaging.platform.signal",
  matrix: "options.messaging.platform.matrix",
  email: "options.messaging.platform.email",
  dingtalk: "options.messaging.platform.dingtalk",
  feishu: "options.messaging.platform.feishu",
  wecom: "options.messaging.platform.wecom",
  weixin: "options.messaging.platform.weixin",
  qqbot: "options.messaging.platform.qqbot",
  webhook: "options.messaging.platform.webhook",
};

const ZH_PLATFORM_NAMES: Record<string, string> = {
  dingtalk: "钉钉",
  email: "电子邮件",
  feishu: "飞书 / Lark",
  qqbot: "QQ 机器人",
  sms: "短信",
  wecom: "企业微信",
  weixin: "微信",
};

function platformName(
  item: HermesMessagingPlatform,
  language: ResolvedLanguage,
): string {
  return language === "zh-CN"
    ? ZH_PLATFORM_NAMES[item.id] || item.name
    : item.name;
}

const ZH_FIELD_LABELS: Record<string, string> = {
  TELEGRAM_BOT_TOKEN: "机器人 Token",
  TELEGRAM_ALLOWED_USERS: "允许使用的用户",
  DISCORD_BOT_TOKEN: "机器人 Token",
  DISCORD_ALLOWED_USERS: "允许使用的用户",
  SLACK_BOT_TOKEN: "Bot Token",
  SLACK_APP_TOKEN: "App Token",
  SLACK_ALLOWED_USERS: "允许使用的用户",
  FEISHU_APP_ID: "应用 App ID",
  FEISHU_APP_SECRET: "应用 App Secret",
  FEISHU_DOMAIN: "服务区域",
  FEISHU_CONNECTION_MODE: "连接方式",
  FEISHU_ALLOWED_USERS: "允许使用的成员",
  FEISHU_ALLOW_ALL_USERS: "允许所有成员使用",
  FEISHU_DM_POLICY: "私聊访问规则",
  FEISHU_GROUP_POLICY: "群聊访问规则",
  FEISHU_HOME_CHANNEL: "默认通知会话",
  FEISHU_HOME_CHANNEL_NAME: "通知会话名称",
  FEISHU_ENCRYPT_KEY: "事件加密密钥",
  FEISHU_VERIFICATION_TOKEN: "事件校验 Token",
  WECOM_BOT_ID: "机器人 ID",
  WECOM_SECRET: "机器人密钥",
  WECOM_DM_POLICY: "私聊访问规则",
  WECOM_HOME_CHANNEL: "默认通知会话",
  WEIXIN_ACCOUNT_ID: "微信账号 ID",
  WEIXIN_TOKEN: "连接 Token",
  WEIXIN_BASE_URL: "服务地址",
  WEIXIN_CDN_BASE_URL: "文件服务地址",
  WEIXIN_ALLOWED_USERS: "允许使用的成员",
  WEIXIN_ALLOW_ALL_USERS: "允许所有成员使用",
  WEIXIN_DM_POLICY: "私聊访问规则",
  WEIXIN_GROUP_POLICY: "群聊访问规则",
  WEIXIN_HOME_CHANNEL: "默认通知会话",
  DINGTALK_CLIENT_ID: "应用 Client ID",
  DINGTALK_CLIENT_SECRET: "应用 Client Secret",
  EMAIL_ADDRESS: "邮箱地址",
  EMAIL_PASSWORD: "邮箱密码或应用专用密码",
  EMAIL_IMAP_HOST: "收件服务器（IMAP）",
  EMAIL_SMTP_HOST: "发件服务器（SMTP）",
  MATRIX_HOMESERVER: "Matrix 服务器地址",
  MATRIX_ACCESS_TOKEN: "访问 Token",
  MATRIX_PASSWORD: "账号密码",
  SIGNAL_HTTP_URL: "Signal Bridge 地址",
  SIGNAL_ACCOUNT: "Signal 账号",
  SIGNAL_ALLOWED_USERS: "允许使用的用户",
  WHATSAPP_ALLOWED_USERS: "允许使用的用户",
  TWILIO_ACCOUNT_SID: "Twilio Account SID",
  TWILIO_AUTH_TOKEN: "Twilio Auth Token",
  TWILIO_PHONE_NUMBER: "Twilio 手机号码",
};

const ZH_FIELD_HELP: Record<string, string> = {
  FEISHU_APP_ID: "在飞书开放平台的应用凭证页面复制。",
  FEISHU_APP_SECRET: "应用密钥只保存在本机，不会在界面中回显。",
  FEISHU_DOMAIN: "中国版飞书选择“飞书”，国际版选择“Lark”。",
  FEISHU_ALLOWED_USERS:
    "填写允许对机器人发消息的用户 ID，多个 ID 用英文逗号分隔。",
  FEISHU_ALLOW_ALL_USERS: "开启后，组织内任何成员都可以使用这个机器人。",
  FEISHU_HOME_CHANNEL: "定时任务和主动通知默认发送到这个会话 ID。",
  FEISHU_HOME_CHANNEL_NAME: "仅用于在界面中辨认这个通知会话。",
  WECOM_BOT_ID: "在企业微信机器人配置中复制。",
  WECOM_SECRET: "机器人密钥只保存在本机。",
  WEIXIN_ACCOUNT_ID: "当前连接的微信账号标识。",
  WEIXIN_TOKEN: "连接凭据只保存在本机，不会在界面中回显。",
  WEIXIN_HOME_CHANNEL: "定时任务和主动通知默认发送到这个会话。",
};

function fieldLabel(
  field: HermesMessagingField,
  language: ResolvedLanguage,
): string {
  if (language === "zh-CN") {
    if (ZH_FIELD_LABELS[field.key]) return ZH_FIELD_LABELS[field.key];
    const suffixLabels: Array<[RegExp, string]> = [
      [/_BOT_TOKEN$/, "机器人 Token"],
      [/_APP_TOKEN$/, "应用 Token"],
      [/_ACCESS_TOKEN$/, "访问 Token"],
      [/_AUTH_TOKEN$/, "认证 Token"],
      [/_TOKEN$/, "连接 Token"],
      [/_APP_ID$/, "应用 ID"],
      [/_CLIENT_ID$/, "客户端 ID"],
      [/_ACCOUNT_ID$/, "账号 ID"],
      [/_BOT_ID$/, "机器人 ID"],
      [/_CLIENT_SECRET$/, "客户端密钥"],
      [/_APP_SECRET$/, "应用密钥"],
      [/_SECRET$/, "连接密钥"],
      [/_PASSWORD$/, "密码"],
      [/_ALLOWED_USERS$/, "允许使用的成员"],
      [/_PHONE_NUMBER$/, "手机号码"],
      [/_HOMESERVER$/, "服务器地址"],
      [/_HOST$/, "服务器地址"],
      [/_URL$/, "服务地址"],
      [/_PORT$/, "服务端口"],
      [/_MODE$/, "连接方式"],
      [/_ACCOUNT$/, "账号"],
      [/_ADDRESS$/, "地址"],
    ];
    const matched = suffixLabels.find(([pattern]) => pattern.test(field.key));
    if (matched) return matched[1];
  }
  return field.label || field.key;
}

function text(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

export function SettingsMessaging({
  profileId = "default",
}: {
  profileId?: string;
}) {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>("channels");
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "channels", label: t("options.messaging.tab.channels") },
    { id: "pairing", label: t("options.messaging.tab.access") },
    { id: "webhooks", label: t("options.messaging.tab.webhooks") },
  ];
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <SettingsPaneHeader
        title={t("options.messaging.title")}
        subtitle={t("options.messaging.description")}
      />
      <div className="border-b border-border/50">
        <PageContent className="px-7" padding="none" size="md">
          <div className="flex h-9 items-end gap-5">
            {tabs.map(({ id, label }) => (
              <button
                className={cn(
                  "relative h-9 px-0.5 text-xs transition-colors after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-transparent",
                  tab === id
                    ? "text-foreground after:bg-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                key={id}
                onClick={() => setTab(id)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </PageContent>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <PageContent bodyClassName="space-y-3" className="pt-3" size="md">
          {tab === "channels" ? (
            <ChannelsPanel profileId={profileId} />
          ) : tab === "pairing" ? (
            <PairingPanel profileId={profileId} />
          ) : (
            <WebhooksPanel profileId={profileId} />
          )}
        </PageContent>
      </ScrollArea>
    </div>
  );
}

function ChannelsPanel({ profileId }: { profileId: string }) {
  const { t, language } = useT();
  const [items, setItems] = useState<HermesMessagingPlatform[]>([]);
  const [gatewayRunning, setGatewayRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>(
    {},
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    kind: "success" | "progress";
    text: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await getHermesMessagingPlatforms(profileId);
    setLoading(false);
    if (result.ok) {
      setItems(result.platforms ?? []);
      setGatewayRunning(result.gateway_running === true);
      setError(null);
    } else {
      setError(
        t("options.messaging.loadError", {
          error: result.error || "Unknown error",
        }),
      );
    }
  }, [profileId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) =>
        needle
          ? `${item.name} ${platformName(item, language)} ${item.id}`
              .toLocaleLowerCase()
              .includes(needle)
          : true,
      )
      .sort(
        (left, right) =>
          Number(right.item.configured) - Number(left.item.configured) ||
          Number(right.item.enabled) - Number(left.item.enabled) ||
          left.index - right.index,
      )
      .map(({ item }) => item);
  }, [items, language, query]);

  const channelGroups = [
    {
      id: "configured",
      title: t("options.messaging.group.configured"),
      description: t("options.messaging.group.configuredDescription"),
      items: filteredItems.filter((item) => item.configured),
    },
    {
      id: "available",
      title: t("options.messaging.group.available"),
      description: t("options.messaging.group.availableDescription"),
      items: filteredItems.filter((item) => !item.configured),
    },
  ];

  const connectedCount = items.filter(
    (item) => item.state === "connected",
  ).length;
  const selectedItem = items.find((item) => item.id === selected) ?? null;

  function refreshAfterRestart() {
    window.setTimeout(() => void refresh(), 1_500);
    window.setTimeout(() => void refresh(), 4_000);
  }

  async function saveAndConnect(item: HermesMessagingPlatform) {
    const missingRequired = item.fields.some(
      (field) =>
        field.required &&
        !field.configured &&
        !drafts[item.id]?.[field.key]?.trim(),
    );
    if (missingRequired) {
      setError(t("options.messaging.missingRequired"));
      return;
    }

    setBusy(`${item.id}:save`);
    setError(null);
    setMessage({ kind: "progress", text: t("options.messaging.saving") });
    const env = Object.fromEntries(
      Object.entries(drafts[item.id] ?? {}).filter(([, value]) => value.trim()),
    );
    const result = await saveHermesMessagingPlatform(
      item.id,
      { enabled: true, env },
      profileId,
    );
    if (!result.ok) {
      setBusy(null);
      setMessage(null);
      setError(result.error || "Save failed");
      return;
    }

    setDrafts((current) => ({ ...current, [item.id]: {} }));
    setMessage({
      kind: "progress",
      text: t("options.messaging.restarting"),
    });
    const restart = await restartHermesGateway();
    setBusy(null);
    if (!restart.ok) {
      setMessage(null);
      setError(
        t("options.messaging.restartFailed", {
          error: restart.error || "Unknown error",
        }),
      );
      await refresh();
      return;
    }

    setMessage({
      kind: "success",
      text: t("options.messaging.saved", {
        channel: platformName(item, language),
      }),
    });
    setSelected(null);
    await refresh();
    refreshAfterRestart();
  }

  async function disable(item: HermesMessagingPlatform) {
    setBusy(`${item.id}:disable`);
    setError(null);
    setMessage({ kind: "progress", text: t("options.messaging.saving") });
    const result = await saveHermesMessagingPlatform(
      item.id,
      { enabled: false },
      profileId,
    );
    if (!result.ok) {
      setBusy(null);
      setMessage(null);
      setError(result.error || "Save failed");
      return;
    }

    const restart = await restartHermesGateway();
    setBusy(null);
    if (!restart.ok) {
      setMessage(null);
      setError(
        t("options.messaging.restartFailed", {
          error: restart.error || "Unknown error",
        }),
      );
    } else {
      setMessage({
        kind: "success",
        text: t("options.messaging.disabled", {
          channel: platformName(item, language),
        }),
      });
      setSelected(null);
    }
    await refresh();
    if (restart.ok) refreshAfterRestart();
  }

  async function test(item: HermesMessagingPlatform) {
    setBusy(`${item.id}:test`);
    setError(null);
    setMessage(null);
    const result = await testHermesMessagingPlatform(item.id, profileId);
    setBusy(null);
    if (!result.ok) {
      setError(result.message || result.error || "Connection test failed");
    } else {
      setMessage({
        kind: "success",
        text: t("options.messaging.testSuccess", {
          channel: platformName(item, language),
        }),
      });
    }
    await refresh();
  }

  return (
    <div className="space-y-4">
      <section className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/15 px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <MessageCircleMore className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {connectedCount
              ? t("options.messaging.summary.connected", {
                  connected: connectedCount,
                  total: items.length,
                })
              : t("options.messaging.summary.none")}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                gatewayRunning
                  ? "bg-[hsl(var(--success))]"
                  : "bg-muted-foreground/45",
              )}
            />
            {gatewayRunning
              ? t("options.messaging.summary.gatewayRunning")
              : t("options.messaging.summary.gatewayStopped")}
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

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
        </div>
      ) : null}
      {message ? (
        <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/15 px-3 py-2.5 text-xs">
          {message.kind === "progress" ? (
            <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--success))]" />
          )}
          <span>{message.text}</span>
        </div>
      ) : null}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/65" />
        <Input
          aria-label={t("options.messaging.search")}
          className="pl-9"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("options.messaging.search")}
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
              <div
                className={cn(
                  group.id === "available"
                    ? "grid gap-2 sm:grid-cols-2"
                    : "space-y-2",
                )}
              >
                {group.items.map((item) => {
                  const descriptionKey = PLATFORM_DESCRIPTION_KEYS[item.id];
                  const description = descriptionKey
                    ? t(descriptionKey)
                    : item.description || item.name;
                  const status = channelStatus(item, t);
                  const displayName = platformName(item, language);
                  const itemBusy = busy?.startsWith(`${item.id}:`) ?? false;
                  const actionLabel = item.configured
                    ? t("options.messaging.manage")
                    : t("options.messaging.configure");

                  return (
                    <article
                      className="overflow-hidden rounded-xl border border-border/65 bg-background"
                      key={item.id}
                    >
                      <button
                        aria-label={actionLabel}
                        className={cn(
                          "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 text-left transition-colors hover:bg-muted/25 disabled:cursor-wait disabled:opacity-60",
                          group.id === "available" ? "min-h-24 py-3" : "py-3.5",
                        )}
                        disabled={itemBusy}
                        onClick={() => setSelected(item.id)}
                        type="button"
                      >
                        <MessagingChannelIcon id={item.id} name={displayName} />
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">
                              {displayName}
                            </span>
                            <Badge
                              className="shrink-0"
                              variant={status.variant}
                            >
                              <span
                                className={cn(
                                  "mr-1.5 h-1.5 w-1.5 rounded-full",
                                  status.dot,
                                )}
                              />
                              {status.label}
                            </Badge>
                          </span>
                          <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                            {description}
                          </span>
                        </span>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="hidden sm:inline">
                            {actionLabel}
                          </span>
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted/45">
                            <ChevronRight className="h-3.5 w-3.5" />
                          </span>
                        </span>
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null,
        )}

        {!loading && filteredItems.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/70 px-4 py-10 text-center text-xs text-muted-foreground">
            {t("options.messaging.empty")}
          </p>
        ) : null}
        {loading ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 px-4 py-10 text-xs text-muted-foreground">
            <CircleDashed className="h-4 w-4 animate-spin" />
            {t("common.loading")}
          </div>
        ) : null}
      </div>
      <ChannelEditorDialog
        busy={busy}
        draft={selectedItem ? (drafts[selectedItem.id] ?? {}) : {}}
        item={selectedItem}
        language={language}
        onChange={(field, value) => {
          if (!selectedItem) return;
          setDrafts((current) => ({
            ...current,
            [selectedItem.id]: {
              ...(current[selectedItem.id] ?? {}),
              [field]: value,
            },
          }));
        }}
        onDisable={(item) => void disable(item)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        onSave={(item) => void saveAndConnect(item)}
        onTest={(item) => void test(item)}
      />
    </div>
  );
}

function ChannelEditorDialog({
  busy,
  draft,
  item,
  language,
  onChange,
  onDisable,
  onOpenChange,
  onSave,
  onTest,
}: {
  busy: string | null;
  draft: Record<string, string>;
  item: HermesMessagingPlatform | null;
  language: ResolvedLanguage;
  onChange: (field: string, value: string) => void;
  onDisable: (item: HermesMessagingPlatform) => void;
  onOpenChange: (open: boolean) => void;
  onSave: (item: HermesMessagingPlatform) => void;
  onTest: (item: HermesMessagingPlatform) => void;
}) {
  const { t } = useT();
  if (!item) {
    return <Dialog onOpenChange={onOpenChange} open={false} />;
  }
  const descriptionKey = PLATFORM_DESCRIPTION_KEYS[item.id];
  const description = descriptionKey
    ? t(descriptionKey)
    : item.description || item.name;
  const status = channelStatus(item, t);
  const displayName = platformName(item, language);
  const itemBusy = busy?.startsWith(`${item.id}:`) ?? false;
  const hasDraft = Object.values(draft).some((value) => value.trim());
  const missingRequired = item.fields.some(
    (field) => field.required && !field.configured && !draft[field.key]?.trim(),
  );
  const needsConnection = item.state !== "connected";
  const advancedFields = item.fields.filter((field) => field.advanced);
  const regularFields = item.fields.filter((field) => !field.advanced);
  const accessFields = regularFields.filter((field) =>
    /(ALLOW|ALLOWED|_DM_POLICY|_GROUP_POLICY)/.test(field.key),
  );
  const deliveryFields = regularFields.filter((field) =>
    /HOME_CHANNEL/.test(field.key),
  );
  const connectionFields = regularFields.filter(
    (field) => !accessFields.includes(field) && !deliveryFields.includes(field),
  );
  const labels =
    language === "zh-CN"
      ? {
          connection: "连接信息",
          connectionHelp: "用于把 Amiba 安全地连接到这个渠道。",
          access: "谁可以使用",
          accessHelp: "设置可以与机器人对话的成员和会话范围。",
          delivery: "通知发送到哪里",
          deliveryHelp: "定时任务和主动通知会默认发送到这里。",
          advanced: "高级连接选项",
        }
      : {
          connection: "Connection details",
          connectionHelp: "Securely connect Amiba to this channel.",
          access: "Who can use it",
          accessHelp: "Control who can talk with the bot and where.",
          delivery: "Notification destination",
          deliveryHelp:
            "Scheduled and proactive notifications go here by default.",
          advanced: "Advanced connection options",
        };

  const fields = (
    title: string,
    help: string,
    values: HermesMessagingField[],
  ) =>
    values.length ? (
      <section className="space-y-3 rounded-xl border border-border/55 bg-background p-4">
        <div>
          <h3 className="text-xs font-semibold">{title}</h3>
          <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
            {help}
          </p>
        </div>
        <div className="space-y-4">
          {values.map((field) => (
            <ChannelField
              draft={draft[field.key]}
              field={field}
              itemId={item.id}
              key={field.key}
              language={language}
              onChange={(value) => onChange(field.key, value)}
            />
          ))}
        </div>
      </section>
    ) : null;

  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent
        className="flex max-h-[calc(100vh-3rem)] flex-col gap-0 overflow-hidden p-0"
        size="lg"
      >
        <header className="flex items-start gap-3 border-b border-border/55 px-5 py-4 pr-12">
          <MessagingChannelIcon id={item.id} name={displayName} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle className="text-base">{displayName}</DialogTitle>
              <Badge variant={status.variant}>
                <span
                  className={cn("mr-1.5 h-1.5 w-1.5 rounded-full", status.dot)}
                />
                {status.label}
              </Badge>
            </div>
            <DialogDescription className="mt-1 text-xs leading-5">
              {description}
            </DialogDescription>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/10 px-5 py-4">
          <div className="mx-auto max-w-[640px] space-y-4">
            <SetupSteps item={item} language={language} />

            {item.docs_url ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border/55 bg-background px-4 py-3">
                <p className="text-[10px] leading-4 text-muted-foreground">
                  {t("options.messaging.step.accountDescription")}
                </p>
                <Button
                  className="shrink-0"
                  onClick={() =>
                    window.open(item.docs_url, "_blank", "noopener,noreferrer")
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <ExternalLink />
                  {t("options.messaging.guide")}
                </Button>
              </div>
            ) : null}

            {item.fields.length ? (
              <>
                {fields(
                  labels.connection,
                  labels.connectionHelp,
                  connectionFields,
                )}
                {fields(labels.access, labels.accessHelp, accessFields)}
                {fields(labels.delivery, labels.deliveryHelp, deliveryFields)}
                {advancedFields.length ? (
                  <details className="group rounded-xl border border-border/55 bg-background">
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-xs font-semibold">
                      <Cable className="h-3.5 w-3.5 text-muted-foreground" />
                      {labels.advanced}
                      <ChevronDown className="ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="space-y-4 border-t border-border/45 px-4 py-4">
                      {advancedFields.map((field) => (
                        <ChannelField
                          draft={draft[field.key]}
                          field={field}
                          itemId={item.id}
                          key={field.key}
                          language={language}
                          onChange={(value) => onChange(field.key, value)}
                        />
                      ))}
                    </div>
                  </details>
                ) : null}
              </>
            ) : (
              <p className="rounded-xl border border-dashed border-border/70 bg-background px-4 py-5 text-xs text-muted-foreground">
                {t("options.messaging.noFields")}
              </p>
            )}

            {item.error ? (
              <div className="flex gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{item.error}</span>
              </div>
            ) : null}
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border/55 bg-background px-5 py-3">
          {item.enabled ? (
            <Button
              disabled={itemBusy}
              onClick={() => onDisable(item)}
              size="sm"
              variant="ghost"
            >
              {t("options.messaging.disable")}
            </Button>
          ) : null}
          {item.enabled && item.configured ? (
            <Button
              disabled={itemBusy}
              onClick={() => onTest(item)}
              size="sm"
              variant="outline"
            >
              <ShieldCheck />
              {t("options.messaging.test")}
            </Button>
          ) : null}
          <Button
            disabled={
              itemBusy || missingRequired || (!needsConnection && !hasDraft)
            }
            onClick={() => onSave(item)}
            size="sm"
          >
            {busy === `${item.id}:save` ? (
              <CircleDashed className="animate-spin" />
            ) : (
              <ArrowUpRight />
            )}
            {needsConnection
              ? t("options.messaging.saveConnect")
              : t("options.messaging.saveChanges")}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function channelStatus(
  item: HermesMessagingPlatform,
  t: ReturnType<typeof useT>["t"],
) {
  if (item.state === "connected") {
    return {
      label: t("options.messaging.status.connected"),
      variant: "success" as const,
      dot: "bg-[hsl(var(--success))]",
    };
  }
  if (item.state === "not_configured") {
    return {
      label: t("options.messaging.status.notConfigured"),
      variant: "warning" as const,
      dot: "bg-[hsl(var(--warning))]",
    };
  }
  if (item.state === "pending_restart") {
    return {
      label: t("options.messaging.status.pendingRestart"),
      variant: "warning" as const,
      dot: "bg-[hsl(var(--warning))]",
    };
  }
  if (item.state === "gateway_stopped") {
    return {
      label: t("options.messaging.status.gatewayStopped"),
      variant: "warning" as const,
      dot: "bg-[hsl(var(--warning))]",
    };
  }
  if (item.state === "startup_failed") {
    return {
      label: t("options.messaging.status.startupFailed"),
      variant: "destructive" as const,
      dot: "bg-destructive-foreground",
    };
  }
  if (
    item.state === "error" ||
    item.state === "failed" ||
    item.state === "disconnected"
  ) {
    return {
      label: t("options.messaging.status.error"),
      variant: "destructive" as const,
      dot: "bg-destructive-foreground",
    };
  }
  if (item.state === "connecting" || item.state === "starting") {
    return {
      label: t("options.messaging.status.connecting"),
      variant: "secondary" as const,
      dot: "bg-muted-foreground",
    };
  }
  if (item.error) {
    return {
      label: t("options.messaging.status.error"),
      variant: "destructive" as const,
      dot: "bg-destructive-foreground",
    };
  }
  if (item.enabled && item.configured) {
    return {
      label: t("options.messaging.status.connecting"),
      variant: "secondary" as const,
      dot: "bg-muted-foreground",
    };
  }
  return {
    label: t("options.messaging.status.disabled"),
    variant: "secondary" as const,
    dot: "bg-muted-foreground/55",
  };
}

function SetupSteps({
  item,
  language,
}: {
  item: HermesMessagingPlatform;
  language: ResolvedLanguage;
}) {
  const { t } = useT();
  const deliveryConfigured = item.fields.some(
    (field) => /HOME_CHANNEL/.test(field.key) && field.configured,
  );
  const steps = [
    {
      label: t("options.messaging.step.account"),
      description: t("options.messaging.step.accountDescription"),
      complete: item.configured,
    },
    {
      label: t("options.messaging.step.credentials"),
      description: t("options.messaging.step.credentialsDescription"),
      complete: item.configured,
    },
    {
      label: language === "zh-CN" ? "设置通知会话" : "Choose a destination",
      description:
        language === "zh-CN"
          ? "指定定时任务和主动通知发送到哪里。"
          : "Choose where scheduled and proactive notifications are sent.",
      complete: deliveryConfigured,
    },
    {
      label: t("options.messaging.step.verify"),
      description: t("options.messaging.step.verifyDescription"),
      complete: item.state === "connected",
    },
  ];
  return (
    <ol className="grid gap-px overflow-hidden rounded-xl border border-border/55 bg-border/55 sm:grid-cols-2">
      {steps.map((step, index) => (
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
            <span className="block text-[11px] font-medium">{step.label}</span>
            <span className="mt-0.5 block text-[9.5px] leading-4 text-muted-foreground">
              {step.description}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function ChannelField({
  draft,
  field,
  itemId,
  language,
  onChange,
}: {
  draft?: string;
  field: HermesMessagingField;
  itemId: string;
  language: ResolvedLanguage;
  onChange: (value: string) => void;
}) {
  const { t } = useT();
  const label = fieldLabel(field, language);
  const value = draft ?? field.value ?? "";
  const description =
    language === "zh-CN"
      ? ZH_FIELD_HELP[field.key] || ""
      : field.description || "";
  const booleanField = /(_ALLOW_ALL_USERS|_ENABLED)$/.test(field.key);
  const options = fieldSelectOptions(field.key, language, value);

  if (booleanField) {
    const checked = ["1", "true", "yes", "on"].includes(value.toLowerCase());
    return (
      <div className="flex items-start justify-between gap-4 rounded-lg border border-border/45 bg-muted/10 px-3 py-3">
        <div className="min-w-0">
          <Label
            className="flex items-center gap-2 text-xs"
            htmlFor={`channel-${itemId}-${field.key}`}
          >
            {label}
            {field.configured ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--success))]" />
            ) : null}
          </Label>
          {description ? (
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        <Switch
          checked={checked}
          id={`channel-${itemId}-${field.key}`}
          onCheckedChange={(next) => onChange(next ? "true" : "false")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <Label className="text-xs" htmlFor={`channel-${itemId}-${field.key}`}>
          {label}
        </Label>
        <span className="text-[9px] text-muted-foreground">
          {field.required
            ? t("options.messaging.required")
            : t("options.messaging.optional")}
        </span>
        {field.configured ? (
          <span className="ml-auto inline-flex items-center gap-1 text-[9px] text-[hsl(var(--success))]">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {language === "zh-CN" ? "已保存" : "Saved"}
          </span>
        ) : null}
      </div>
      {description ? (
        <p className="text-[10px] leading-4 text-muted-foreground">
          {description}
        </p>
      ) : null}
      {options ? (
        <Select onValueChange={onChange} value={value || undefined}>
          <SelectTrigger id={`channel-${itemId}-${field.key}`}>
            <SelectValue
              placeholder={t("options.messaging.enterValue", { field: label })}
            />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          autoComplete="off"
          id={`channel-${itemId}-${field.key}`}
          onChange={(event) => onChange(event.target.value)}
          placeholder={
            field.configured
              ? t("options.messaging.savedValue")
              : t("options.messaging.enterValue", { field: label })
          }
          type={field.secret ? "password" : "text"}
          value={field.secret ? (draft ?? "") : value}
        />
      )}
      {field.url ? (
        <button
          className="inline-flex items-center gap-1 text-[9.5px] text-primary hover:underline"
          onClick={() =>
            window.open(field.url, "_blank", "noopener,noreferrer")
          }
          type="button"
        >
          {field.help || field.url}
          <ExternalLink className="h-2.5 w-2.5" />
        </button>
      ) : language !== "zh-CN" && field.help ? (
        <p className="text-[9.5px] text-muted-foreground">{field.help}</p>
      ) : null}
    </div>
  );
}

function fieldSelectOptions(
  key: string,
  language: ResolvedLanguage,
  currentValue: string,
): Array<{ value: string; label: string }> | null {
  const zh = language === "zh-CN";
  let options: Array<{ value: string; label: string }> | null = null;
  if (key.endsWith("_DOMAIN")) {
    options = [
      { value: "feishu", label: zh ? "飞书（中国）" : "Feishu (China)" },
      { value: "lark", label: zh ? "Lark（国际）" : "Lark (International)" },
    ];
  } else if (key.endsWith("_CONNECTION_MODE")) {
    options = [
      {
        value: "websocket",
        label: zh ? "长连接（推荐）" : "WebSocket (Recommended)",
      },
      { value: "webhook", label: "Webhook" },
    ];
  } else if (key.endsWith("_DM_POLICY")) {
    options = [
      { value: "pairing", label: zh ? "首次使用时审批" : "Approve first use" },
      {
        value: "allowlist",
        label: zh ? "仅允许名单成员" : "Allowlisted users only",
      },
      { value: "open", label: zh ? "所有成员" : "Everyone" },
      {
        value: "disabled",
        label: zh ? "不允许私聊" : "Disable direct messages",
      },
    ];
  } else if (key.endsWith("_GROUP_POLICY")) {
    options = [
      {
        value: "allowlist",
        label: zh ? "仅允许指定群聊" : "Allowlisted groups only",
      },
      { value: "open", label: zh ? "所有群聊" : "All groups" },
      { value: "disabled", label: zh ? "不允许群聊" : "Disable group chats" },
    ];
  }
  if (
    options &&
    currentValue &&
    !options.some((option) => option.value === currentValue)
  ) {
    options.push({ value: currentValue, label: currentValue });
  }
  return options;
}

function PairingPanel({ profileId }: { profileId: string }) {
  const [pending, setPending] = useState<Array<Record<string, unknown>>>([]);
  const [approved, setApproved] = useState<Array<Record<string, unknown>>>([]);
  const [platform, setPlatform] = useState("telegram");
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const result = await getHermesPairings(profileId);
    if (result.ok) {
      setPending(result.pending ?? []);
      setApproved(result.approved ?? []);
    } else setError(result.error || "Failed to load pairing requests");
  }, [profileId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function approve(chosenPlatform = platform, chosenTarget = target) {
    const result = await approveHermesPairing(
      chosenPlatform,
      chosenTarget,
      profileId,
    );
    if (!result.ok) setError(result.error || "Approval failed");
    else {
      setTarget("");
      await refresh();
    }
  }
  return (
    <div className="space-y-5">
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <section>
        <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold">
          <Users className="h-4 w-4" />
          Pending approvals
        </h3>
        <div className="flex gap-2">
          <Input
            className="w-32"
            onChange={(event) => setPlatform(event.target.value)}
            placeholder="Platform"
            value={platform}
          />
          <Input
            className="flex-1"
            onChange={(event) => setTarget(event.target.value)}
            placeholder="Pairing code or request ID"
            value={target}
          />
          <Button
            disabled={!platform.trim() || !target.trim()}
            onClick={() => void approve()}
          >
            <CheckCircle2 />
            Approve
          </Button>
        </div>
        <ul className="mt-2 space-y-1">
          {pending.map((item, index) => {
            const p = text(item, "platform") || platform;
            const id = text(item, "request_id", "id", "code");
            return (
              <li
                className="flex items-center gap-2 rounded-lg border border-border/50 px-3 py-2 text-xs"
                key={id || index}
              >
                <span className="font-medium">{p}</span>
                <code className="min-w-0 flex-1 truncate text-muted-foreground">
                  {id}
                </code>
                <Button
                  onClick={() => void approve(p, id)}
                  size="sm"
                  variant="ghost"
                >
                  Approve
                </Button>
              </li>
            );
          })}
        </ul>
      </section>
      <section>
        <h3 className="mb-2 text-xs font-semibold">Approved users</h3>
        <ul className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60">
          {approved.map((item, index) => {
            const p = text(item, "platform");
            const id = text(item, "user_id", "id");
            return (
              <li
                className="flex items-center gap-2 px-3 py-2.5 text-xs"
                key={`${p}:${id}:${index}`}
              >
                <span className="font-medium">{p}</span>
                <code className="min-w-0 flex-1 truncate text-muted-foreground">
                  {id}
                </code>
                <Button
                  className="text-destructive hover:text-destructive"
                  onClick={() =>
                    void (async () => {
                      const result = await revokeHermesPairing(
                        p,
                        id,
                        profileId,
                      );
                      if (!result.ok) setError(result.error || "Revoke failed");
                      else await refresh();
                    })()
                  }
                  size="icon"
                  variant="ghost"
                >
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function WebhooksPanel({ profileId }: { profileId: string }) {
  const [items, setItems] = useState<HermesWebhookSubscription[]>([]);
  const [name, setName] = useState("");
  const [events, setEvents] = useState("");
  const [description, setDescription] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editEvents, setEditEvents] = useState("");
  const [saving, setSaving] = useState(false);
  const refresh = useCallback(async () => {
    const result = await getHermesWebhooks(profileId);
    if (result.ok) setItems(result.subscriptions ?? []);
    else setError(result.error || "Failed to load webhooks");
  }, [profileId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    const result = await createHermesWebhook(
      {
        name,
        description,
        events: events
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      },
      profileId,
    );
    setCreating(false);
    if (!result.ok) setError(result.error || "Create failed");
    else {
      setSecret(result.secret ?? null);
      setName("");
      setDescription("");
      setEvents("");
      await refresh();
    }
  }
  function startEdit(item: HermesWebhookSubscription) {
    setEditing(item.name);
    setEditDescription(item.description || "");
    setEditEvents(item.events.join(", "));
    setError(null);
  }
  async function saveEdit(item: HermesWebhookSubscription) {
    setSaving(true);
    setError(null);
    const result = await updateHermesWebhook(
      item.name,
      {
        description: editDescription,
        events: editEvents
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      },
      profileId,
    );
    setSaving(false);
    if (!result.ok) setError(result.error || "Update failed");
    else {
      setEditing(null);
      await refresh();
    }
  }
  return (
    <div className="space-y-4">
      <form
        className="space-y-2 rounded-xl border border-border/60 bg-muted/15 p-3"
        onSubmit={(event) => void create(event)}
      >
        <h3 className="flex items-center gap-2 text-xs font-semibold">
          <Webhook className="h-4 w-4" />
          Create webhook
        </h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            onChange={(event) => setName(event.target.value)}
            placeholder="Route name"
            value={name}
          />
          <Input
            onChange={(event) => setEvents(event.target.value)}
            placeholder="Events, comma-separated"
            value={events}
          />
        </div>
        <Input
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Description"
          value={description}
        />
        <div className="flex justify-end">
          <Button disabled={creating || !name.trim()} type="submit">
            <Plus />
            Create
          </Button>
        </div>
      </form>
      {secret ? (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs">
          <p className="font-medium">
            Copy this secret now; it will only be shown once.
          </p>
          <code className="mt-2 block break-all select-all font-mono">
            {secret}
          </code>
        </div>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <ul className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60">
        {items.map((item) => (
          <li className="px-3 py-3" key={item.name}>
            <div className="flex items-center gap-3">
              <Webhook className="h-4 w-4 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium">{item.name}</span>
                <span className="block truncate font-mono text-[9.5px] text-muted-foreground">
                  {item.url}
                </span>
              </span>
              <Button
                aria-label={`Edit ${item.name}`}
                onClick={() =>
                  editing === item.name ? setEditing(null) : startEdit(item)
                }
                size="icon"
                variant="ghost"
              >
                <Pencil />
              </Button>
              <Switch
                checked={item.enabled}
                onCheckedChange={(enabled) =>
                  void setHermesWebhookEnabled(
                    item.name,
                    enabled,
                    profileId,
                  ).then(refresh)
                }
              />
              <Button
                className="text-destructive hover:text-destructive"
                onClick={() =>
                  void (async () => {
                    if (!confirm(`Delete webhook “${item.name}”?`)) return;
                    const result = await deleteHermesWebhook(
                      item.name,
                      profileId,
                    );
                    if (!result.ok) setError(result.error || "Delete failed");
                    else await refresh();
                  })()
                }
                size="icon"
                variant="ghost"
              >
                <Trash2 />
              </Button>
            </div>
            {editing === item.name ? (
              <div className="mt-3 grid gap-2 border-t border-border/45 pt-3">
                <Input
                  onChange={(event) => setEditDescription(event.target.value)}
                  placeholder="Description"
                  value={editDescription}
                />
                <Input
                  onChange={(event) => setEditEvents(event.target.value)}
                  placeholder="Events, comma-separated"
                  value={editEvents}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    onClick={() => setEditing(null)}
                    size="sm"
                    variant="ghost"
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={saving}
                    onClick={() => void saveEdit(item)}
                    size="sm"
                  >
                    Save
                  </Button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
