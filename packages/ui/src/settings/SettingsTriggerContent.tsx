import { Settings } from "lucide-react";

import { useT } from "@amiba/i18n";

import { cn } from "../primitives";

/**
 * Default content for the official settings trigger seat. The profile menu
 * requests the icon and visible label; compact hosts retain a hidden label.
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
