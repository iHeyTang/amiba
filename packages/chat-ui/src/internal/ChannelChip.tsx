/**
 * Channel chip — renders the source-of-origin badge for a session.
 *
 * Two visual variants:
 *  - ``inline`` (default): icon + label, used in SessionDrawer rows.
 *  - ``compact``: icon-only, used in the TabBar where space is scarce.
 *
 * Icon mapping lives here (not in @hermes-x/core) so the registry stays
 * renderer-free. Adding a new ``ChannelIconTag`` in the registry
 * requires adding a case to ``iconFor`` below.
 */

import {
  AtSign,
  Bell,
  CalendarClock,
  Globe,
  Hash,
  Hexagon,
  House,
  Mail,
  MessageCircle,
  MessageCircleMore,
  MessageSquare,
  Monitor,
  Phone,
  Send,
  Sparkles,
  Terminal,
  Webhook,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import {
  isLocalChannel,
  resolveChannel,
  type ChannelDescriptor,
  type ChannelIconTag,
} from "@hermes-x/core";
import { useT, type MessageKey, type TranslateFn } from "@hermes-x/i18n";
import { cn } from "@hermes-x/utils";

/**
 * Map an icon tag to a Lucide component. ``MessageCircle`` is a safe
 * fallback for any chat-shaped surface we don't have a specific glyph
 * for; ``Webhook`` covers the integration / API shapes.
 *
 * Note: Lucide doesn't ship brand marks for every platform; we pick
 * shapes that reliably read as the right kind of channel rather than
 * lying with a literal logo. Brand glyphs can be swapped in later
 * (e.g. via simple-icons) without touching call sites.
 */
function iconFor(tag: ChannelIconTag): LucideIcon {
  switch (tag) {
    case "desktop":
      return Monitor;
    case "extension":
      return Sparkles;
    case "cli":
    case "tui":
      return Terminal;
    case "cron":
      return CalendarClock;
    case "feishu":
      return MessageSquare;
    case "telegram":
      return Send;
    case "slack":
      return Hash;
    case "discord":
      return MessageCircleMore;
    case "wecom":
    case "weixin":
      return MessageSquare;
    case "dingtalk":
      return Bell;
    case "whatsapp":
      return Phone;
    case "signal":
      return MessageCircle;
    case "matrix":
      return Hexagon;
    case "email":
      return Mail;
    case "sms":
      return AtSign;
    case "webhook":
      return Webhook;
    case "homeassistant":
      return House;
    case "bluebubbles":
      return MessageSquare;
    case "qqbot":
      return MessageCircle;
    case "yuanbao":
      return Workflow;
    case "generic":
    default:
      return Globe;
  }
}

interface Props {
  /** SessionDB ``source`` value. Nullish renders as local. */
  source: string | null | undefined;
  variant?: "inline" | "compact";
  /** Extra classes for the wrapping span. */
  className?: string;
  /**
   * When true, always render (even for local sources). Default ``false``
   * means local sources collapse to ``null`` so the chip only shows up
   * for sessions originating elsewhere — that's the read-side signal
   * users care about. Set ``true`` on surfaces (e.g. a settings page)
   * that want to label every session regardless of origin.
   */
  alwaysShow?: boolean;
}

export function ChannelChip({
  source,
  variant = "inline",
  className,
  alwaysShow = false,
}: Props) {
  const { t } = useT();
  if (!alwaysShow && isLocalChannel(source)) return null;
  const descriptor = resolveChannel(source);
  const Icon = iconFor(descriptor.icon);
  // Try the i18n key; fall back to the registry's English label if the
  // catalog doesn't have an entry yet. The fallback is "leak the source
  // string" friendly because ``resolveChannel`` already stamps unknown
  // ids onto ``fallbackLabel``.
  const translated = t(descriptor.labelKey as MessageKey);
  const label =
    translated === descriptor.labelKey ? descriptor.fallbackLabel : translated;
  return (
    <ChannelBadge
      Icon={Icon}
      label={label}
      variant={variant}
      className={className}
      title={describeFor(descriptor, label, t)}
    />
  );
}

function describeFor(
  d: ChannelDescriptor,
  label: string,
  t: TranslateFn,
): string {
  if (d.isLocal) return label;
  // i18n key intentionally generic so we don't need a per-channel
  // key — interpolation gives the localised channel name.
  const tip = t("channels.remoteTitle" as MessageKey, { name: label });
  return tip === "channels.remoteTitle" ? `From ${label}` : tip;
}

interface BadgeProps {
  Icon: LucideIcon;
  label: string;
  variant: "inline" | "compact";
  className?: string;
  title?: string;
}

function ChannelBadge({ Icon, label, variant, className, title }: BadgeProps) {
  if (variant === "compact") {
    return (
      <span
        title={title}
        aria-label={title ?? label}
        className={cn(
          "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-muted-foreground/80",
          className,
        )}
      >
        <Icon className="h-3 w-3" />
      </span>
    );
  }
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
        className,
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      <span className="leading-none">{label}</span>
    </span>
  );
}
