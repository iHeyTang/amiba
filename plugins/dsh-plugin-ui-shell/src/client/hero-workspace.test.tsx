// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { HeroWorkspacePicker } from './hero-workspace.js';
import type { EmptyWorkspaceOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client';
it('maps real WorkspaceIds to paths and refuses deleted or unknown entries', () => {
  const request = { open: true, path: '/project', onPick: vi.fn(), onClose: vi.fn() };
  const state = { items: [{ workspaceId: 'workspace-a', path: '/project' }] };
  let owner!: EmptyWorkspaceOwnerProps;
  const view = render(<HeroWorkspacePicker request={request} useWorkspaces={((select: (state: unknown) => unknown) => select(state)) as never} render={value => { owner = value; return null; }} />);
  expect(owner).toMatchObject({ open: true, selectedId: 'workspace-a' });
  owner.onPick('workspace-a' as never);
  expect(request.onPick).toHaveBeenCalledWith('/project');
  owner.onPick('missing' as never);
  expect(request.onPick).toHaveBeenCalledTimes(1);
  owner.onClose(); expect(request.onClose).toHaveBeenCalledOnce();
  view.unmount();
});
