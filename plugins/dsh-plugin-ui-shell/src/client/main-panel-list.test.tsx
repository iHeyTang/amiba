// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SlotCore, type PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots';
import { createMainPanelListSource, MainPanelList } from './main-panel-list.js';
import { MainPanelNavigation } from './main-panel-navigation.js';
import { LayoutNavigation } from './layout-navigation.js';

// Use the actual navigation row while avoiding unrelated platform providers.
vi.mock('@amiba/ui/plugin', () => import('../../../../packages/ui/src/navigation/NavigationRow'));
afterEach(cleanup);

function fixture() {
  const core = new SlotCore();
  const root = core.register({ name: 'root', children: {
    main: { kind: 'keyed', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' },
  } }, ({ renderSlot }: PropsRenderSlots<'main' | 'sidebar.panellist'>) => { void renderSlot; return null; });
  const hasPanel = (id: string) => core.entriesOfSlot('main').some(entry => entry.options.key === id);
  const source = createMainPanelListSource(core, hasPanel);
  const showConversation = vi.fn();
  const navigation = new MainPanelNavigation(new LayoutNavigation(), {
    hasPanel, subscribe: fn => core.subscribe('main', fn),
  }, showConversation);
  return { core, source, navigation, showConversation, dispose() { navigation.dispose(); root(); } };
}

it('sorts real registrations, updates localized metadata and reacts to matching main lifetimes', async () => {
  const f = fixture();
  document.documentElement.lang = 'en';
  const injected = vi.fn(() => { throw new Error('Metadata must not invoke a component injection'); });
  const last = f.core.register({ name: 'sidebar.panellist', id: 'last', order: 2, inject: injected }, () => null);
  const first = f.core.register({ name: 'sidebar.panellist', id: 'first', order: -1,
    label: () => document.documentElement.lang === 'en' ? 'First' : '第一个' }, () => null);
  expect(f.source.getSnapshot()).toEqual([
    { id: 'first', label: 'First', available: false }, { id: 'last', label: 'last', available: false },
  ]);
  const before = f.source.getSnapshot();
  expect(f.source.getSnapshot()).toBe(before);
  const changed = vi.fn(); const off = f.source.subscribe(changed);
  const main = f.core.register({ name: 'main', key: 'first' }, () => null);
  await Promise.resolve();
  expect(changed).toHaveBeenCalled();
  expect(f.source.getSnapshot()[0]?.available).toBe(true);
  document.documentElement.lang = 'zh-CN';
  expect(f.source.getSnapshot()[0]?.label).toBe('第一个');
  main(); expect(f.source.getSnapshot()[0]?.available).toBe(false);
  off(); changed.mockClear(); first(); last();
  expect(changed).not.toHaveBeenCalled();
  expect(injected).not.toHaveBeenCalled();
  f.dispose();
});

it('uses native button navigation and real selected icon owners; unloaded destinations cannot be clicked', async () => {
  const f = fixture();
  f.core.register({ name: 'sidebar.panellist', id: 'tools', label: 'Tools' }, () => null);
  const icon = vi.fn((id: string, owner: { size: number; active: boolean }) => <span data-testid="icon">{id}:{owner.size}:{String(owner.active)}</span>);
  const view = render(<MainPanelList source={f.source} navigation={f.navigation} renderIcon={icon} />);
  const button = screen.getByRole('button', { name: 'Tools' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  let remove!: () => void;
  await act(async () => { remove = f.core.register({ name: 'main', key: 'tools' }, () => null); });
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  expect(f.navigation.getSnapshot().activePanelId).toBe('tools');
  expect(button.getAttribute('aria-current')).toBe('page');
  expect(screen.getByTestId('icon').textContent).toBe('tools:16:true');
  await act(async () => remove());
  expect(button.disabled).toBe(true);
  expect(button.hasAttribute('aria-current')).toBe(false);
  expect(f.showConversation).toHaveBeenCalledOnce();
  view.unmount(); f.dispose();
});

it('keeps the reserved conversation entry available and marks only the actual native conversation active', () => {
  const f = fixture();
  f.core.register({ name: 'sidebar.panellist', id: 'conversation', label: 'Conversation' }, () => null);
  const icon = (id: string, owner: { active: boolean }) => <span>{id}:{String(owner.active)}</span>;
  const view = render(<MainPanelList source={f.source} navigation={f.navigation} conversationActive={false} renderIcon={icon} />);
  const button = screen.getByRole('button', { name: 'Conversation' }) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  expect(button.hasAttribute('aria-current')).toBe(false);
  fireEvent.click(button);
  expect(f.showConversation).toHaveBeenCalledOnce();
  expect(f.navigation.getSnapshot().activePanelId).toBeNull();
  view.rerender(<MainPanelList source={f.source} navigation={f.navigation} conversationActive renderIcon={icon} />);
  expect(button.getAttribute('aria-current')).toBe('page');
  view.unmount(); f.dispose();
});
