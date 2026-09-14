import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import { WorkspaceNavigationRow, usePluginT } from "@amiba/ui/plugin";
import { ConciergeBell } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";

import { stewardI18n } from "./i18n.js";
import type { StewardClientState } from "./state.js";

export type StewardNavigationProps = PropsRuntime<"amiba.workspace.navigation"> & {
  state: StewardClientState;
  label?: string;
  open(): void;
};

export function StewardNavigation({
  activeView,
  state,
  sessionActivity,
  open,
  label: entryLabel,
}: StewardNavigationProps): ReactNode {
  const { t } = usePluginT(stewardI18n);
  const stewardId = useSyncExternalStore(state.subscribe, state.stewardSessionId);
  const label = entryLabel ?? t("steward.nav");
  return (
    <WorkspaceNavigationRow
      navigation={{ activeView, sessionActivity }}
      target={{ kind: "session", sessionId: stewardId }}
      aria-label={label}
      data-testid="sidebar-item-steward"
      icon={<ConciergeBell />}
      label={label}
      onClick={open}
      title={label}
    />
  );
}
