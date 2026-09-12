import type { AmibaNotification } from "@amiba/dsh-plugin-notification-hub";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePluginT } from "@amiba/ui/plugin";
import { Check, CircleAlert, LoaderCircle, MessageCircle } from "lucide-react";
import type {
  DesktopPetBridge,
  DesktopPetLayout,
} from "@amiba/app-runtime/platform";
import { petsI18n } from "./i18n.js";
import { petMessages, placeDesktopMessage } from "./desktop-message.js";

export function DesktopMessage({
  notifications,
  dismiss,
  layout,
  api,
  active,
}: {
  active: boolean;
  notifications: AmibaNotification[];
  dismiss(id: string): Promise<void>;
  layout: DesktopPetLayout;
  api: DesktopPetBridge;
}) {
  const { t } = usePluginT(petsI18n);
  const [expanded, setExpanded] = useState(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout>>();
  const list = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({
    width: innerWidth,
    height: innerHeight,
  });
  const messages = petMessages(notifications).map((n) => ({
    activity: n,
    message: { key: n.id, phase: n.status ?? n.kind },
  }));
  const [error, setError] = useState(false);
  const shown = active && messages.length > 0 && !layout.editing;
  useEffect(() => {
    const resize = () =>
      setViewport({ width: innerWidth, height: innerHeight });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(
    () => () => {
      clearTimeout(collapseTimer.current);
      void api.setIgnoreMouse(true);
    },
    [api, shown],
  );
  useEffect(() => {
    if (!shown) setExpanded(false);
  }, [shown]);
  // Freeze the painted bounds for this batch of notices. The SVG viewport has
  // transparent margins; using its top leaves a large empty gap above the pet.
  const messageBounds = useRef<DesktopPetLayout["visual"] | null>(null);
  if (messages.length === 0) messageBounds.current = null;
  if (
    messages.length > 0 &&
    !messageBounds.current &&
    layout.visual.width > 0 &&
    (layout.visual.width !== 1 || layout.visual.height !== 1)
  )
    messageBounds.current = { ...layout.visual };
  const bounds = messageBounds.current ?? { x: 0, y: 0, width: 1, height: 1 };
  const cardHeight = 44;
  // The anchor changes on user drag/resize, never on animated silhouette updates.
  const anchor = layout.anchor;
  const position = placeDesktopMessage(
    {
      x: anchor.x + bounds.x * anchor.size,
      y: anchor.y + bounds.y * anchor.size,
      width: bounds.width * anchor.size,
      height: bounds.height * anchor.size,
    },
    viewport,
    cardHeight,
  );
  const available = Math.max(
    cardHeight,
    position.above
      ? position.top + cardHeight - 12
      : viewport.height - position.top - 12,
  );
  const contentHeight = expanded
    ? messages.length * (cardHeight + 6) - 6
    : cardHeight + Math.min(Math.max(messages.length - 1, 0), 2) * 4;
  const stackHeight = Math.min(contentHeight, available);
  useLayoutEffect(() => {
    // Keep the nearest card anchored while the scrollable viewport animates.
    // Stop following after the transition so the expanded list scrolls normally.
    const until = performance.now() + 220;
    let frame = 0;
    const pin = () => {
      if (list.current)
        list.current.scrollTop = position.above ? list.current.scrollHeight : 0;
      if (performance.now() < until) frame = requestAnimationFrame(pin);
    };
    pin();
    return () => cancelAnimationFrame(frame);
  }, [expanded, position.above, contentHeight]);
  if (!shown) return null;
  const openStack = () => {
    clearTimeout(collapseTimer.current);
    setExpanded(true);
    void api.setIgnoreMouse(false);
  };
  const renderCard = (
    { activity: value, message }: (typeof messages)[number],
    index: number,
  ) => {
    const interactive = expanded || index === 0;
    const busy = ["thinking", "responding", "tooling"].includes(message.phase);
    const Icon = busy
      ? LoaderCircle
      : message.phase === "completed"
        ? Check
        : message.phase === "waiting"
          ? MessageCircle
          : CircleAlert;
    return (
      <div
        key={message.key}
        data-desktop-pet-message={message.phase}
        aria-hidden={!interactive}
        className="group absolute flex w-full shrink-0 items-center rounded-xl border border-border bg-background text-foreground transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none"
        style={{
          height: cardHeight,
          ...(position.above ? { bottom: 0 } : { top: 0 }),
          zIndex: messages.length - index,
          transformOrigin: position.above ? "center bottom" : "center top",
          transform: `translateY(${(position.above ? -1 : 1) * (expanded ? index * (cardHeight + 6) : Math.min(index, 2) * 4)}px) scaleX(${expanded ? 1 : 1 - Math.min(index, 2) * 0.04})`,
          opacity: expanded || index < 3 ? 1 : 0,
          pointerEvents: interactive ? "auto" : "none",
        }}
      >
        {!value.activity && (
          <button
            aria-label={t("pets.message.dismiss")}
            tabIndex={interactive ? 0 : -1}
            style={!interactive ? { opacity: 0 } : undefined}
            className="order-2 mr-2 shrink-0 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100"
            onClick={() => {
              void dismiss(message.key)
                .then(() => setError(false))
                .catch(() => setError(true));
            }}
          >
            {t("pets.message.ignore")}
          </button>
        )}
        <button
          title={t("pets.message.open")}
          tabIndex={interactive ? 0 : -1}
          style={{ opacity: interactive ? 1 : 0 }}
          disabled={value.activity && !value.sessionId}
          className="order-1 transition-opacity duration-200 motion-reduce:transition-none flex h-full min-w-0 flex-1 items-center gap-2 rounded-xl pl-3 text-left"
          onClick={() => {
            if (value.sessionId) void api.openConversation(value.sessionId);
            else void dismiss(message.key).catch(() => setError(true));
          }}
        >
          <Icon
            size={14}
            className={
              busy
                ? "shrink-0 animate-spin motion-reduce:animate-none text-muted-foreground"
                : "shrink-0 text-primary"
            }
          />
          <span className="min-w-0 flex-1">
            <span
              data-desktop-pet-message-title
              className="block truncate text-[13px] font-medium leading-[18px]"
              title={value.title?.trim() || t("pets.message.untitled")}
            >
              {value.title?.trim() || t("pets.message.untitled")}
            </span>
            <span
              role="status"
              className="block truncate text-[11px] leading-[14px] text-muted-foreground"
            >
              {value.body || t(`pets.message.${message.phase}`)}
            </span>
          </span>
        </button>
      </div>
    );
  };
  return (
    <div
      aria-label={error ? t("pets.message.dismissError") : undefined}
      data-desktop-pet-stack
      data-expanded={expanded}
      data-count={messages.length}
      className="transition-[height] duration-200 ease-out motion-reduce:transition-none"
      style={{
        position: "absolute",
        left: position.left,
        ...(position.above
          ? { bottom: viewport.height - position.top - cardHeight }
          : { top: position.top }),
        width: position.width,
        height: stackHeight,
        pointerEvents: "auto",
      }}
      onPointerEnter={openStack}
      onPointerMove={openStack}
      onFocusCapture={openStack}
      onPointerLeave={() => {
        void api.setIgnoreMouse(true);
        collapseTimer.current = setTimeout(() => setExpanded(false), 140);
      }}
    >
      {messages.length > 1 && (
        <span
          className="absolute -right-2 -top-2 z-20 rounded-full border border-border bg-background px-1.5 text-xs text-muted-foreground transition-[opacity,transform] duration-200 motion-reduce:transition-none"
          aria-hidden={expanded}
          aria-label={`${messages.length} ${t("pets.message.count")}`}
          style={{
            opacity: expanded ? 0 : 1,
            transform: expanded ? "scale(.8)" : "scale(1)",
            pointerEvents: "none",
          }}
        >
          {messages.length}
        </span>
      )}
      <div
        ref={list}
        style={{
          position: "relative",
          height: "100%",
          overflowY: "auto",
          overflowX: "hidden",
          scrollbarWidth: "none",
          overscrollBehavior: "contain",
        }}
      >
        <div
          className="relative transition-[height] duration-200 ease-out motion-reduce:transition-none"
          style={{ height: contentHeight }}
        >
          {messages.map(renderCard)}
        </div>
      </div>
    </div>
  );
}
