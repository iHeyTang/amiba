import { describe, expect, it, vi } from 'vitest';
import { MainPanelNavigation } from './main-panel-navigation.js';
import { LayoutNavigation } from './layout-navigation.js';

function fixture() {
  const ids = new Set(['tools', 'search']);
  const listeners = new Set<() => void>();
  const registry = {
    hasPanel: (id: string) => ids.has(id),
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
  const navigation = new LayoutNavigation();
  const conversation = vi.fn();
  const panels = new MainPanelNavigation(navigation, registry, conversation);
  return { panels, navigation, conversation, listeners, remove(id: string) {
    ids.delete(id); for (const fn of [...listeners]) fn();
  } };
}

describe('global panel navigation contract', () => {
  it('rejects unknown panels without changing selection or cancelling pending work', () => {
    const { panels, navigation } = fixture();
    panels.selectPanel('tools');
    const before = panels.getSnapshot();
    const signal = navigation.beginNavigation();
    const changed = vi.fn(); panels.subscribe(changed);
    expect(() => panels.selectPanel('missing')).toThrow('not registered');
    expect(panels.getSnapshot()).toBe(before);
    expect(signal.aborted).toBe(false);
    expect(changed).not.toHaveBeenCalled();
    panels.dispose();
  });
  it('returns to conversation only when the selected panel unloads', () => {
    const { panels, navigation, conversation, remove } = fixture();
    panels.selectPanel('tools'); remove('search');
    expect(panels.getSnapshot().activePanelId).toBe('tools');
    const signal = navigation.beginNavigation(); remove('tools');
    expect(signal.aborted).toBe(true);
    expect(panels.getSnapshot().activePanelId).toBe(null);
    expect(conversation).toHaveBeenCalledOnce(); panels.dispose();
  });
  it('preserves native destinations but selecting null explicitly requests conversation', () => {
    const { panels, conversation } = fixture();
    panels.selectPanel('tools'); panels.leavePanel();
    expect(panels.getSnapshot().activePanelId).toBe(null);
    expect(conversation).not.toHaveBeenCalled();
    panels.selectPanel(null);
    expect(conversation).toHaveBeenCalledOnce(); panels.dispose();
  });
  it('keeps snapshot identity on repeated selection while cancelling old navigation', () => {
    const { panels, navigation } = fixture();
    panels.selectPanel('tools'); const before = panels.getSnapshot();
    const signal = navigation.beginNavigation(); panels.selectPanel('tools');
    expect(panels.getSnapshot()).toBe(before);
    expect(signal.aborted).toBe(true); panels.dispose();
  });
  it('isolates listener errors and disposes registry subscriptions and pending navigation', () => {
    const { panels, navigation, listeners } = fixture();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const changed = vi.fn();
    panels.subscribe(() => { throw new Error('broken subscriber'); });
    const off = panels.subscribe(changed); panels.selectPanel('tools');
    expect(changed).toHaveBeenCalledOnce(); expect(log).toHaveBeenCalledOnce(); off();
    const signal = navigation.beginNavigation(); panels.dispose(); panels.dispose();
    expect(signal.aborted).toBe(true); expect(listeners.size).toBe(0);
    expect(() => panels.selectPanel('search')).toThrow('disposed');
    expect(navigation.beginNavigation().aborted).toBe(true); log.mockRestore();
  });
});
