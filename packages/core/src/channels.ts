/**
 * Channel registry.
 *
 * A "channel" is the surface a conversation originated from — feishu,
 * telegram, the desktop app itself, the CLI, etc. SessionDB tags each
 * session with a ``source`` string (the gateway's ``Platform`` enum
 * value, or one of a few internal tags like ``browser-extension``,
 * ``cli``, ``tui``, ``cron``). This module is the single source of
 * truth for "what do we know about that source string" — display label
 * (i18n key), an icon hint that chat-ui maps to a Lucide component, and
 * whether hermes-x considers it a *local* channel (i.e. one we own and
 * may write into) versus a *remote* channel (read-only window onto
 * someone else's engine).
 *
 * The registry is intentionally renderer-free: descriptors carry only
 * data (strings). The visual mapping (icon component, badge colours)
 * lives in chat-ui so this package keeps zero React/UI deps.
 */

/**
 * Icon hint — chat-ui's ChannelChip maps each tag to a concrete Lucide
 * component. Adding a new tag here MUST be paired with a case in
 * ``ChannelChip.tsx``.
 */
export type ChannelIconTag =
  | "desktop"
  | "extension"
  | "cli"
  | "tui"
  | "cron"
  | "feishu"
  | "telegram"
  | "slack"
  | "discord"
  | "wecom"
  | "weixin"
  | "dingtalk"
  | "whatsapp"
  | "signal"
  | "matrix"
  | "email"
  | "sms"
  | "webhook"
  | "homeassistant"
  | "bluebubbles"
  | "qqbot"
  | "yuanbao"
  | "generic";

export interface ChannelDescriptor {
  /** SessionDB ``source`` value this descriptor matches. */
  id: string;
  /**
   * i18n key for the channel's display label. chat-ui resolves it via
   * ``useT()``; consumers that need a string without a t() instance can
   * fall back to ``fallbackLabel``.
   */
  labelKey: string;
  /** English short label, used when no i18n catalog is available. */
  fallbackLabel: string;
  /** Icon hint — chat-ui maps this to a concrete component. */
  icon: ChannelIconTag;
  /**
   * Whether hermes-x is the writing engine for sessions on this
   * channel. Local channels show the normal composer; remote channels
   * render the read-only banner instead.
   *
   * "Local" here means: this hermes-x instance (extension or desktop)
   * is the one that writes new turns. CLI / TUI / cron / gateway-driven
   * channels are not local even when running on the same machine —
   * they have their own engine that we must not race against.
   */
  isLocal: boolean;
}

/**
 * Sources hermes-x itself writes today. Kept here (not in
 * sessions-runtime) so non-runtime consumers can reuse without dragging
 * the store along.
 */
export const LOCAL_CHANNEL_SOURCES = new Set<string>([
  // sessions-runtime tags every session it creates with this, regardless
  // of whether it's the extension or the desktop app — see
  // ``SOURCE_BROWSER_EXTENSION`` in ``sessions-runtime/store.ts``.
  "browser-extension",
  // Reserved for a future desktop-specific source tag; treat as local
  // so we don't accidentally lock out our own sessions if the tag is
  // ever introduced.
  "desktop",
]);

const REGISTRY: ChannelDescriptor[] = [
  // ── Local ──
  {
    id: "browser-extension",
    labelKey: "channels.extension",
    fallbackLabel: "Extension",
    icon: "extension",
    isLocal: true,
  },
  {
    id: "desktop",
    labelKey: "channels.desktop",
    fallbackLabel: "Desktop",
    icon: "desktop",
    isLocal: true,
  },

  // ── Adjacent engines (same machine, different writer) ──
  // Read-only from hermes-x's perspective: a CLI / TUI process owns the
  // session; sending from desktop would race the other engine.
  {
    id: "cli",
    labelKey: "channels.cli",
    fallbackLabel: "CLI",
    icon: "cli",
    isLocal: false,
  },
  {
    id: "tui",
    labelKey: "channels.tui",
    fallbackLabel: "TUI",
    icon: "tui",
    isLocal: false,
  },
  {
    id: "cron",
    labelKey: "channels.cron",
    fallbackLabel: "Scheduled",
    icon: "cron",
    isLocal: false,
  },

  // ── Messaging platforms (gateway-owned) ──
  // ids match ``gateway/config.py:Platform`` enum values verbatim so
  // we don't have to translate between the gateway and the registry.
  {
    id: "feishu",
    labelKey: "channels.feishu",
    fallbackLabel: "Feishu",
    icon: "feishu",
    isLocal: false,
  },
  {
    id: "telegram",
    labelKey: "channels.telegram",
    fallbackLabel: "Telegram",
    icon: "telegram",
    isLocal: false,
  },
  {
    id: "slack",
    labelKey: "channels.slack",
    fallbackLabel: "Slack",
    icon: "slack",
    isLocal: false,
  },
  {
    id: "discord",
    labelKey: "channels.discord",
    fallbackLabel: "Discord",
    icon: "discord",
    isLocal: false,
  },
  {
    id: "wecom",
    labelKey: "channels.wecom",
    fallbackLabel: "WeCom",
    icon: "wecom",
    isLocal: false,
  },
  {
    id: "wecom_callback",
    labelKey: "channels.wecom",
    fallbackLabel: "WeCom",
    icon: "wecom",
    isLocal: false,
  },
  {
    id: "weixin",
    labelKey: "channels.weixin",
    fallbackLabel: "WeChat",
    icon: "weixin",
    isLocal: false,
  },
  {
    id: "dingtalk",
    labelKey: "channels.dingtalk",
    fallbackLabel: "DingTalk",
    icon: "dingtalk",
    isLocal: false,
  },
  {
    id: "whatsapp",
    labelKey: "channels.whatsapp",
    fallbackLabel: "WhatsApp",
    icon: "whatsapp",
    isLocal: false,
  },
  {
    id: "signal",
    labelKey: "channels.signal",
    fallbackLabel: "Signal",
    icon: "signal",
    isLocal: false,
  },
  {
    id: "matrix",
    labelKey: "channels.matrix",
    fallbackLabel: "Matrix",
    icon: "matrix",
    isLocal: false,
  },
  {
    id: "email",
    labelKey: "channels.email",
    fallbackLabel: "Email",
    icon: "email",
    isLocal: false,
  },
  {
    id: "sms",
    labelKey: "channels.sms",
    fallbackLabel: "SMS",
    icon: "sms",
    isLocal: false,
  },
  {
    id: "webhook",
    labelKey: "channels.webhook",
    fallbackLabel: "Webhook",
    icon: "webhook",
    isLocal: false,
  },
  {
    id: "msgraph_webhook",
    labelKey: "channels.webhook",
    fallbackLabel: "Webhook",
    icon: "webhook",
    isLocal: false,
  },
  {
    id: "homeassistant",
    labelKey: "channels.homeassistant",
    fallbackLabel: "Home Assistant",
    icon: "homeassistant",
    isLocal: false,
  },
  {
    id: "bluebubbles",
    labelKey: "channels.bluebubbles",
    fallbackLabel: "iMessage",
    icon: "bluebubbles",
    isLocal: false,
  },
  {
    id: "qqbot",
    labelKey: "channels.qqbot",
    fallbackLabel: "QQ",
    icon: "qqbot",
    isLocal: false,
  },
  {
    id: "yuanbao",
    labelKey: "channels.yuanbao",
    fallbackLabel: "Yuanbao",
    icon: "yuanbao",
    isLocal: false,
  },
  // Gateway-internal / catch-all — surfaced so users see *something*
  // sensible rather than a raw source string.
  {
    id: "gateway",
    labelKey: "channels.gateway",
    fallbackLabel: "Gateway",
    icon: "generic",
    isLocal: false,
  },
  {
    id: "api_server",
    labelKey: "channels.api",
    fallbackLabel: "API",
    icon: "webhook",
    isLocal: false,
  },
  {
    id: "local",
    labelKey: "channels.local",
    fallbackLabel: "Local",
    icon: "generic",
    isLocal: false,
  },
];

const REGISTRY_BY_ID = new Map<string, ChannelDescriptor>(
  REGISTRY.map((d) => [d.id, d]),
);

/**
 * Fallback descriptor returned when ``source`` is unknown. Renders as a
 * generic chip so unknown sources (plugin platforms the gateway accepts
 * via ``Platform._missing_``) still surface in the UI.
 */
export const UNKNOWN_CHANNEL: ChannelDescriptor = {
  id: "__unknown__",
  labelKey: "channels.unknown",
  fallbackLabel: "Other",
  icon: "generic",
  isLocal: false,
};

/**
 * Look up a descriptor for a SessionDB ``source`` value. Returns
 * ``UNKNOWN_CHANNEL`` for unknown sources rather than throwing — UI
 * must be tolerant of plugin platforms we haven't catalogued yet.
 * ``source=null`` (legacy / migrated rows with no tag) is treated as
 * local so users aren't locked out of their own historical sessions.
 */
export function resolveChannel(
  source: string | null | undefined,
): ChannelDescriptor {
  if (source == null || source === "") {
    return REGISTRY_BY_ID.get("browser-extension")!;
  }
  return REGISTRY_BY_ID.get(source) ?? {
    ...UNKNOWN_CHANNEL,
    id: source,
    fallbackLabel: source,
  };
}

/**
 * True when hermes-x is the writing engine for sessions tagged with
 * this source. Drives the read-only banner gating in SidePanelView.
 */
export function isLocalChannel(source: string | null | undefined): boolean {
  if (source == null || source === "") return true;
  return LOCAL_CHANNEL_SOURCES.has(source);
}

/** Read-only registry snapshot for consumers that need to enumerate. */
export function listChannels(): readonly ChannelDescriptor[] {
  return REGISTRY;
}
