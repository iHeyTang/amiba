import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ResourceRegistry } from '../resources/resources.js'
import { DockController } from './dockkit/index.js'
import { TabDomain } from './tab-domain.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap { 'dock-test': number }
}

it('committed duplicate tabs share a real resource stream; last close releases and undo reopens it', async () => {
  const resources = new ResourceRegistry(new Context());
  const streams: AbortSignal[] = [];
  const offProvider = resources.register({
    protocol: 'dock-test',
    async *open(_address, { signal }) {
      streams.push(signal);
      yield { ok: true as const, value: streams.length };
      await new Promise<void>(resolve => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
      });
    },
  });
  const controller = new DockController();
  const sessionId = 'resource-session' as SessionId;
  const domain = new TabDomain({ openResourceIn: vi.fn(), openTabIn: vi.fn(), closeIn: vi.fn() },
    (address, signal) => resources.pin(address, signal));
  const offLayout = controller.subscribe(() => domain.sync(sessionId, controller.getSnapshot().state));
  const address = 'dsh-resource://dock-test/file';
  const source = resources.source(address);
  try {
    const first = controller.openContent({ kind: 'file', contentId: address, title: 'file' });
    await vi.waitFor(() => expect(source.getSnapshot().value).toBe(1));
    const second = controller.duplicateTab(first);
    expect(second).not.toBe(first);
    expect(streams).toHaveLength(1);
    controller.setExpanded(false);
    expect(streams[0]?.aborted).toBe(false);
    controller.closeTab(first);
    expect(streams[0]?.aborted).toBe(false);
    controller.closeTab(second);
    expect(streams[0]?.aborted).toBe(true);
    expect(source.getSnapshot().value).toBeUndefined();
    expect(controller.undo()).toBe(true);
    await vi.waitFor(() => expect(source.getSnapshot().value).toBe(2));
    expect(resources.source(address)).toBe(source);
    domain.dispose();
    expect(streams[1]?.aborted).toBe(true);
  } finally {
    offLayout();
    domain.dispose();
    offProvider();
  }
});
