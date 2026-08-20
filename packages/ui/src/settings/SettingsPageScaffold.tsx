import { ArrowLeft } from "lucide-react";
import { type ReactNode } from "react";

import { useT } from "@amiba/i18n";

import { PaneHeaderBar } from "../navigation/PaneHeaderBar";
import { PageContent, ScrollArea, cn } from "../primitives";
import {
  SettingsPageChromeProvider,
  useSettingsPageChrome,
} from "./page-chrome";

export interface SettingsPageScaffoldProps {
  icon?: ReactNode;
  title: ReactNode;
  headerClassName?: string;
  headerHeightPx?: number;
  scroll?: "page" | "self";
  /**
   * The official `settings.action` seat — optional actions rendered in the
   * page header before Close, whose registrants own visibility, behaviour and
   * copy. It sits BESIDE the `data-settings-page-actions` portal container,
   * not instead of it: the portal is Amiba's in-tree channel (a page mounts
   * its own head controls through `SettingsPageActions`), the seat is the
   * out-of-tree one (a plugin registers a shell-level action once and it
   * shows on every page). Both render into the same trailing cluster; the
   * seat is dispatched bare, so an unoccupied one adds no box of its own.
   */
  actions?: ReactNode;
  /**
   * The modal shell's close control, rendered last in the trailing cluster —
   * the same position the official shell gives it (content-column header,
   * after the actions). Omitted when Settings is not hosted in a dialog.
   */
  closeControl?: ReactNode;
  children: ReactNode;
}

/**
 * The one settings layout: fixed single-row head (same PaneHeaderBar base as
 * the chat surface) + shell-owned scroll + PageContent width constraint.
 * Pages render pure content; head actions arrive via SettingsPageActions and
 * drill-in pages override the head via useSettingsPageHeader.
 */
export function SettingsPageScaffold(props: SettingsPageScaffoldProps) {
  return (
    <SettingsPageChromeProvider>
      <ScaffoldBody {...props} />
    </SettingsPageChromeProvider>
  );
}

function ScaffoldBody({
  icon,
  title,
  headerClassName,
  headerHeightPx = 40,
  scroll = "page",
  actions,
  closeControl,
  children,
}: SettingsPageScaffoldProps) {
  const { t } = useT();
  const { setActionsHost, override } = useSettingsPageChrome();
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <PaneHeaderBar
        heightPx={headerHeightPx}
        className={headerClassName}
        leading={
          <>
            {override?.onBack ? (
              <button
                type="button"
                aria-label={t("common.back")}
                className="app-no-drag inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
                onClick={override.onBack}
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            ) : icon ? (
              <span className="pointer-events-none inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">
                {icon}
              </span>
            ) : null}
            <h2 className="min-w-0 truncate text-[13px] font-medium tracking-tight text-foreground/75">
              {override ? override.title : title}
            </h2>
          </>
        }
        trailing={
          <>
            {actions}
            <div
              data-settings-page-actions
              className="flex items-center gap-1.5"
              ref={setActionsHost}
            />
            {closeControl}
          </>
        }
      />
      {scroll === "page" ? (
        <ScrollArea className="min-h-0 min-w-0 flex-1">
          <PageContent size="md">{children}</PageContent>
        </ScrollArea>
      ) : (
        <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col")}>
          {children}
        </div>
      )}
    </div>
  );
}
