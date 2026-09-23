import { useRef, type ReactNode } from 'react';
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store';
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client';
import type { EmptyWorkspaceOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client';

export function HeroWorkspacePicker({ request, useWorkspaces, render }: {
  request: { anchorRef?: EmptyWorkspaceOwnerProps["anchorRef"]; open: boolean; path: string | null; onPick(path: string): void; onClose(): void };
  useWorkspaces: SnapshotSelectorHook<WorkspaceSnapshot>;
  render(owner: EmptyWorkspaceOwnerProps): ReactNode;
}) {
  const workspaces = useWorkspaces(state => state.items);
  const latest = useRef({ workspaces, request });
  latest.current = { workspaces, request };
  return <>{render({ anchorRef: request.anchorRef, open: request.open, selectedId: workspaces.find(item => item.path === request.path)?.workspaceId,
    onPick(id) { const { workspaces, request } = latest.current; const workspace = workspaces.find(item => item.workspaceId === id); if (request.open && workspace) request.onPick(workspace.path); },
    onClose: request.onClose,
  })}</>;
}
