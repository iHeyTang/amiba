import type { RefObject } from "react";
import { Folder, FolderPlus, X } from "lucide-react";

import { useT } from "@amiba/i18n";
import { cn } from "../primitives";

export interface WorkspaceControlProps {
  buttonRef?: RefObject<HTMLButtonElement>;
  expanded?: boolean;
  path?: string | null;
  /** Present only on the id-less Home surface. Conversation workspaces are
   * immutable after the first message creates the session. */
  onChoose?: () => void;
  onClear?: () => void;
  disabled?: boolean;
  className?: string;
}

function workspacePathParts(value: string): {
  name: string;
} {
  const normalized = value.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  const name = parts.at(-1) || normalized || value;
  return { name };
}

/**
 * Execution-context controls shared by the id-less home composer and a real
 * conversation. Composer supplies the shelf; this component supplies the
 * local runtime + current repo hierarchy inside it.
 */
export function WorkspaceControl({
  path,
  buttonRef,
  expanded,
  onChoose,
  onClear,
  disabled,
  className,
}: WorkspaceControlProps) {
  const { t } = useT();
  const parts = path ? workspacePathParts(path) : null;

  return (
    <div
      role="group"
      aria-label={t("workspace.context")}
      className={cn(
        "group flex min-w-0 items-center gap-0.5 text-[11px]",
        className,
      )}
    >
      {onChoose ? (
        <button
          type="button"
          data-workspace-chip
          ref={buttonRef}
          aria-haspopup={expanded === undefined ? undefined : "menu"}
          aria-expanded={expanded}
          onClick={onChoose}
          disabled={disabled}
          title={path || t("workspace.openFolder")}
          aria-label={
            path ? t("workspace.changeFolder") : t("workspace.openFolder")
          }
          className={cn(
            "flex h-6 min-w-0 items-center gap-1.5 rounded-full px-2.5 font-medium",
            "text-foreground/90 transition-colors hover:bg-background/70 hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {parts ? (
            <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <FolderPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="max-w-48 truncate">
            {parts?.name || t("workspace.openFolder")}
          </span>
        </button>
      ) : (
        <div
          data-workspace-chip
          title={path || undefined}
          className="flex h-6 min-w-0 items-center gap-1.5 rounded-full px-2.5 font-medium text-foreground/80"
        >
          <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="max-w-48 truncate">{parts?.name}</span>
        </div>
      )}
      {path && onClear && (
        <button
          type="button"
          onClick={onClear}
          disabled={disabled}
          aria-label={t("workspace.clearFolder")}
          title={t("workspace.clearFolder")}
          className="flex h-6 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/45 opacity-55 transition-[color,background-color,opacity] hover:bg-background/70 hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-30"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
