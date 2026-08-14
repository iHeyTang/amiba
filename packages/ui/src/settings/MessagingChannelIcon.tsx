import appleIcon from "@iconify-icons/logos/apple";
import discordIcon from "@iconify-icons/logos/discord-icon";
import mattermostIcon from "@iconify-icons/logos/mattermost-icon";
import microsoftIcon from "@iconify-icons/logos/microsoft-icon";
import teamsIcon from "@iconify-icons/logos/microsoft-teams";
import signalIcon from "@iconify-icons/logos/signal";
import slackIcon from "@iconify-icons/logos/slack-icon";
import telegramIcon from "@iconify-icons/logos/telegram";
import twilioIcon from "@iconify-icons/logos/twilio-icon";
import whatsappIcon from "@iconify-icons/logos/whatsapp-icon";
import dingTalkIcon from "@iconify-icons/ri/dingding-fill";
import { Icon, type IconifyIcon } from "@iconify/react";
import {
  Mail,
  MessagesSquare,
  RadioTower,
  Server,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import {
  siGooglechat,
  siHomeassistant,
  siLine,
  siMatrix,
  siNtfy,
  siSimplex,
  siTencentqq,
  siWechat,
  type SimpleIcon,
} from "simple-icons";

type BrandIcon =
  | { kind: "iconify"; icon: IconifyIcon }
  | { kind: "simple"; icon: SimpleIcon; color: string }
  | { kind: "lucide"; icon: LucideIcon; color?: string }
  | { kind: "monogram"; label: string; color: string; background: string };

const PLATFORM_ICONS: Record<string, BrandIcon> = {
  telegram: { kind: "iconify", icon: telegramIcon },
  discord: { kind: "iconify", icon: discordIcon },
  slack: { kind: "iconify", icon: slackIcon },
  whatsapp: { kind: "iconify", icon: whatsappIcon },
  whatsapp_cloud: { kind: "iconify", icon: whatsappIcon },
  signal: { kind: "iconify", icon: signalIcon },
  mattermost: { kind: "iconify", icon: mattermostIcon },
  teams: { kind: "iconify", icon: teamsIcon },
  msgraph_webhook: { kind: "iconify", icon: microsoftIcon },
  email: { kind: "lucide", icon: Mail },
  bluebubbles: { kind: "iconify", icon: appleIcon },
  photon: { kind: "iconify", icon: appleIcon },
  sms: { kind: "iconify", icon: twilioIcon },
  dingtalk: { kind: "iconify", icon: dingTalkIcon },
  matrix: { kind: "simple", icon: siMatrix, color: "#0DBD8B" },
  google_chat: { kind: "simple", icon: siGooglechat, color: "#00AC47" },
  homeassistant: {
    kind: "simple",
    icon: siHomeassistant,
    color: "#18BCF2",
  },
  line: { kind: "simple", icon: siLine, color: "#06C755" },
  ntfy: { kind: "simple", icon: siNtfy, color: "#317F6F" },
  simplex: { kind: "simple", icon: siSimplex, color: "#111111" },
  qqbot: { kind: "simple", icon: siTencentqq, color: "#12B7F5" },
  wecom: { kind: "simple", icon: siWechat, color: "#07C160" },
  wecom_callback: { kind: "simple", icon: siWechat, color: "#07C160" },
  weixin: { kind: "simple", icon: siWechat, color: "#07C160" },
  buzz: {
    kind: "monogram",
    label: "🐝",
    color: "#171717",
    background: "#F8C440",
  },
  raft: {
    kind: "monogram",
    label: "R",
    color: "#FFFFFF",
    background: "#171717",
  },
  yuanbao: {
    kind: "monogram",
    label: "元",
    color: "#FFFFFF",
    background: "#1677FF",
  },
  webhook: { kind: "lucide", icon: Webhook, color: "#7C3AED" },
  api_server: { kind: "lucide", icon: Server },
  relay: { kind: "lucide", icon: RadioTower },
  irc: { kind: "lucide", icon: MessagesSquare },
};

// Official app icon extracted from the installed Lark client. Kept inline so
// channel settings never depend on network availability for a provider logo.
const FEISHU_ICON_SRC =
  "data:image/png;base64,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";

export function MessagingChannelIcon({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const normalizedId = id.toLocaleLowerCase();
  const icon = PLATFORM_ICONS[normalizedId];

  return (
    <span
      aria-label={`${name} logo`}
      className="flex h-10 w-10 shrink-0 items-center justify-center"
      role="img"
    >
      {normalizedId === "feishu" || normalizedId === "lark" ? (
        <img
          alt=""
          aria-hidden="true"
          className="h-8 w-8 object-contain"
          src={FEISHU_ICON_SRC}
        />
      ) : icon?.kind === "iconify" ? (
        <Icon aria-hidden="true" className="h-8 w-8" icon={icon.icon} />
      ) : icon?.kind === "simple" ? (
        <svg aria-hidden="true" className="h-7 w-7" viewBox="0 0 24 24">
          <path d={icon.icon.path} fill={icon.color} />
        </svg>
      ) : icon?.kind === "lucide" ? (
        <icon.icon
          aria-hidden="true"
          className="h-7 w-7"
          style={{ color: icon.color }}
        />
      ) : icon?.kind === "monogram" ? (
        <span
          aria-hidden="true"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-semibold"
          style={{ backgroundColor: icon.background, color: icon.color }}
        >
          {icon.label}
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-xs font-semibold uppercase text-background"
        >
          {name.trim().slice(0, 1)}
        </span>
      )}
    </span>
  );
}
