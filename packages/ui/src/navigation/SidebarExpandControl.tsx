import { PanelLeftOpen } from "lucide-react";

import { usePluginT as useT } from "@amiba/i18n/plugin";
import { cn } from "../primitives";

export interface SidebarExpandControlProps {
  className?: string;
  collapsed: boolean;
  onExpand: () => void;
  visible?: boolean;
}

export function SidebarExpandControl({
  className,
  collapsed,
  onExpand,
  visible = collapsed,
}: SidebarExpandControlProps) {
  const { t } = useT();

  return (
    <span
      className={cn(
        "relative h-7 shrink-0",
        collapsed ? "w-7" : "w-0",
        collapsed && className,
      )}
    >
      <button
        aria-hidden={!visible}
        aria-label={t("chat.expandSidebar")}
        className={cn(
          "app-no-drag absolute left-0 top-0 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
          visible ? "visible" : "invisible pointer-events-none",
        )}
        data-testid="sidebar-expand-control"
        onClick={onExpand}
        tabIndex={visible ? 0 : -1}
        title={t("chat.expandSidebar")}
        type="button"
      >
        <PanelLeftOpen aria-hidden className="h-4 w-4" />
      </button>
    </span>
  );
}
