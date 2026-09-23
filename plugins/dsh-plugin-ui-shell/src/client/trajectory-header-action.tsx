import { createContext, useContext } from "react";
import { ArrowLeft, ListTree } from "lucide-react";
import { usePluginT } from "@amiba/i18n/plugin";

/** The action slot keeps its official empty owner; navigation stays in the shell. */
export const TrajectoryNavigationContext = createContext<{
  sessionId: string | null | undefined;
  available: boolean;
  active: boolean;
  select: (id: string | null) => void;
} | null>(null);

export function TrajectoryHeaderAction({ sessionId }: { sessionId: string }) {
  const navigation = useContext(TrajectoryNavigationContext);
  const { language } = usePluginT();
  if (!navigation?.available || navigation.sessionId !== sessionId) return null;
  const zh = language === "zh-CN";
  const label = navigation.active
    ? zh
      ? "返回对话"
      : "Back to chat"
    : zh
      ? "会话记录"
      : "Transcript";
  const Icon = navigation.active ? ArrowLeft : ListTree;
  return (
    <button
      type="button"
      className="amiba-header-action gap-1.5 px-1.5 text-xs"
      title={
        navigation.active
          ? label
          : zh
            ? "查看消息、执行事件和工具调用详情"
            : "Inspect messages, events and tool calls"
      }
      onClick={() => navigation.select(navigation.active ? null : "trajectory")}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
