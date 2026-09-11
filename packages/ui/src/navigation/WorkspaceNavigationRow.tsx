import type { AmibaWorkspaceNavigationOwner } from "@amiba/extension-sdk";
import { NavigationRow, type NavigationRowProps } from "./NavigationRow";

export type WorkspaceNavigationTarget =
  | { kind: "workspace"; viewId: string }
  | { kind: "session"; sessionId: string | null | undefined };

export interface WorkspaceNavigationRowProps extends Omit<NavigationRowProps, "active" | "aria-current"> {
  navigation: AmibaWorkspaceNavigationOwner;
  target: WorkspaceNavigationTarget;
}

/** Plugins declare destinations; the shell's visible location owns selection.
 * A retained runtime session must never select a row behind another workspace.
 */
export function WorkspaceNavigationRow({ navigation, target, ...props }: WorkspaceNavigationRowProps) {
  const active = target.kind === "workspace"
    ? navigation.activeView === target.viewId
    : navigation.activeView === "chats" && Boolean(target.sessionId) &&
      navigation.sessionActivity?.visibleSessionId === target.sessionId;
  return <NavigationRow {...props} active={active} />;
}
