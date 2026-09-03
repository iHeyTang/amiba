import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import { NavigationRow, usePluginT } from "@amiba/ui/plugin";
import { ConciergeBell } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";

import { stewardI18n } from "./i18n.js";
import type { StewardClientState } from "./state.js";

export type StewardNavigationProps = PropsRuntime<"amiba.workspace.navigation"> & {
  state: StewardClientState;
  /** Current official session id, or undefined. */
  currentSessionId(): string | undefined;
  subscribeCurrent(listener: () => void): () => void;
  open(): void;
};

export function StewardNavigation({
  state,
  currentSessionId,
  subscribeCurrent,
  open,
}: StewardNavigationProps): ReactNode {
  const { t } = usePluginT(stewardI18n);
  const stewardId = useSyncExternalStore(state.subscribe, state.stewardSessionId);
  const current = useSyncExternalStore(subscribeCurrent, currentSessionId);
  const label = t("steward.nav");
  return (
    <NavigationRow
      active={Boolean(stewardId) && current === stewardId}
      aria-label={label}
      data-testid="sidebar-item-steward"
      icon={<ConciergeBell />}
      label={label}
      onClick={open}
      title={label}
    />
  );
}
