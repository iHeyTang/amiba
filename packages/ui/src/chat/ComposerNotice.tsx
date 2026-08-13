import { CircleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useT } from "@amiba/i18n";

export interface ComposerNoticeProps {
  detail: string;
  onDismiss: () => void;
  title: string;
}

/** Compact, expandable diagnostics for recoverable composer-local failures. */
export function ComposerNotice({
  detail,
  onDismiss,
  title,
}: ComposerNoticeProps) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(false);
  }, [detail, title]);

  return (
    <div
      aria-live="polite"
      className="pointer-events-auto w-full max-w-lg rounded-xl border border-border/40 bg-popover/95 px-2.5 py-2 text-popover-foreground shadow-[0_10px_28px_-18px_rgb(0_0_0_/_0.28)] backdrop-blur-xl"
      role="alert"
    >
      <div className="flex min-w-0 items-center gap-2">
        <CircleAlert
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 text-destructive/65"
        />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {title}
        </span>
        <button
          aria-expanded={expanded}
          className="h-6 shrink-0 rounded-md px-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {t(
            expanded
              ? "composer.notice.hideDetails"
              : "composer.notice.showDetails",
          )}
        </button>
        <button
          aria-label={t("notifier.dismiss")}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
          onClick={onDismiss}
          type="button"
        >
          <X aria-hidden className="h-3.5 w-3.5" />
        </button>
      </div>
      {expanded ? (
        <p className="ml-[1.375rem] mt-1.5 max-h-28 overflow-y-auto whitespace-pre-wrap break-words pr-1 text-[10px] leading-4 text-muted-foreground [overflow-wrap:anywhere]">
          {detail}
        </p>
      ) : null}
    </div>
  );
}
