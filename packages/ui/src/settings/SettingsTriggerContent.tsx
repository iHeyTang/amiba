import { Settings } from "lucide-react";

import { useT } from "@amiba/i18n";

import { cn } from "../primitives";

/**
 * Amiba's own content for the sidebar settings row: gear glyph + label.
 *
 * It is the row's body on hosts with no plugin runtime, AND the `fallback`
 * the product shell hands to `renderSlot("settings.trigger", { wide })` — so
 * an unoccupied seat looks exactly as the row always did, and there is one
 * implementation rather than two that can drift.
 *
 * `wide` is honoured the way the official trigger honours it: the label goes
 * visually hidden on a narrow rail while staying the button's accessible
 * name. Amiba's collapsed sidebar animates to zero width rather than to a
 * rail today, so this is the seat's contract being kept rather than a visual
 * Amiba currently reaches — the owner share is the sidebar's real state
 * either way.
 */
export function SettingsTriggerContent({ wide }: { wide: boolean }) {
  const { t } = useT();
  return (
    <>
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground transition-colors [&_svg]:h-4 [&_svg]:w-4">
        <Settings className="h-4 w-4" />
      </span>
      <span className={cn("min-w-0 flex-1 truncate", !wide && "sr-only")}>
        {t("chat.settings")}
      </span>
    </>
  );
}
