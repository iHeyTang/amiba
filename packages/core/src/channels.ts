/**
 * Channel registry.
 *
 * A "channel" is the surface a conversation originated from — feishu,
 * telegram, this machine, the CLI, etc. SessionDB tags each session
 * with a ``source`` string (the gateway's ``Platform`` enum value, or
 * one of a few internal tags: ``local``, ``cli``, ``tui``, ``cron``).
 * This module is the single source of
 * truth for "what do we know about that source string" — display label
 * (i18n key), an icon hint that chat-ui maps to a Lucide component, and
 * whether hermes-x considers it a *local* channel (i.e. one we own and
 * may write into) versus a *remote* channel (read-only window onto
 * someone else's engine).
 *
 * All hermes-x surfaces (extension + desktop main window + Quick-Ask)
 * share a single ``source="local"`` tag — the backplane folds legacy
 * ``"browser-extension"`` / ``"desktop"`` values onto it on boot.
 *
 * The registry is intentionally renderer-free: descriptors carry only
 * data (strings). The visual mapping (icon component, badge colours)
 * lives in chat-ui so this package keeps zero React/UI deps.
 */

// ---------------------------------------------------------------------------
// Source string constants
// ---------------------------------------------------------------------------
//
// SessionDB ``source`` values that hermes-x itself writes. Kept here next
// to the registry so any consumer (renderer, main process, tooling) can
// import the canonical strings instead of hand-typing them. Only one
// value today; if a future surface earns its own channel, add the
// constant, a descriptor below, and an entry in
// ``LOCAL_CHANNEL_SOURCES`` if it's locally writable.

/**
 * Canonical "this machine" source tag, written by every local hermes-x
 * surface (browser extension sidepanel/options/newtab, desktop main
 * window, and Quick-Ask). One value across the board — the surface
 * that wrote a row isn't a user-visible distinction and so doesn't
 * earn its own source string.
 *
 * Pre-unification rows tagged ``"browser-extension"`` /
 * ``"desktop"`` are normalised to this value on backplane boot (see
 * ``hermes-plugin-http-backplane/.../sessions/migrations.py``), so the
 * client doesn't carry back-compat aliases — by the time the renderer
 * reads the SessionDB, legacy values are already gone.
 */
export const SOURCE_LOCAL = "local";

/**
 * Icon hint — chat-ui's ChannelChip maps each tag to a concrete Lucide
 * component. Adding a new tag here MUST be paired with a case in
 * ``ChannelChip.tsx``.
 */
export type ChannelIconTag =
  | "local"
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
 * Sources hermes-x itself classifies as local. Single canonical value
 * — the backplane migration folds legacy hermes-x source tags onto
 * this one before the renderer ever sees them.
 */
export const LOCAL_CHANNEL_SOURCES = new Set<string>([SOURCE_LOCAL]);

const REGISTRY: ChannelDescriptor[] = [
  // ── Local ──
  // Single descriptor for every "this machine" surface.
  {
    id: SOURCE_LOCAL,
    labelKey: "channels.local",
    fallbackLabel: "Local",
    icon: "local",
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
 * ``source=null`` / ``""`` (rows that pre-date the source field, or
 * arrived without one) collapse onto the canonical local descriptor.
 */
export function resolveChannel(
  source: string | null | undefined,
): ChannelDescriptor {
  if (source == null || source === "") {
    return REGISTRY_BY_ID.get(SOURCE_LOCAL)!;
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

/**
 * Resolve the SessionDB ``source`` tag for the current hermes-x surface.
 * Returns the single canonical local source for every hermes-x app
 * (extension + desktop main window + Quick-Ask) — they're all just
 * "this machine" from the user's perspective, so the on-disk tag is
 * uniform. Legacy ``"browser-extension"`` / ``"desktop"`` rows are
 * normalised to this value by the backplane on boot, so the renderer
 * never needs to special-case them.
 */
export function getLocalSource(): string {
  return SOURCE_LOCAL;
}
