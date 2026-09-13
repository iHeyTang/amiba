import { useSyncExternalStore, type ReactNode } from 'react';
import { NavigationRow } from '@amiba/ui/plugin';
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots';
import type { SlotContributionsCtx, ContributionsSource } from './session-list-sources.js';
import type { MainPanelNavigation } from './main-panel-navigation.js';

export interface MainPanelRow { id: string; label: string; available: boolean }

/** Only registration metadata is read here; icon inject factories run in the renderer. */
export function createMainPanelListSource(
  slots: SlotContributionsCtx,
  hasPanel: (id: string) => boolean,
): ContributionsSource<MainPanelRow> {
  let version = '', language = '';
  let snapshot: readonly MainPanelRow[] = [];
  return {
    getSnapshot() {
      const next = `${slots.getVersion('sidebar.panellist')}:${slots.getVersion('main')}`;
      const lang = typeof document === 'undefined' ? '' : document.documentElement.lang;
      if (next !== version || lang !== language) {
        version = next; language = lang;
        snapshot = slots.entriesOfSlot('sidebar.panellist').slice()
          .sort((a, b) => (a.options.order ?? 0) - (b.options.order ?? 0))
          .flatMap(({ options }) => options.id === undefined ? [] : [{
            id: options.id,
            label: resolveSlotLabel(options.label) ?? options.id,
            available: hasPanel(options.id),
          }]);
      }
      return snapshot;
    },
    subscribe(listener) {
      const off = ['sidebar.panellist', 'main'].map(name => slots.subscribe(name, listener));
      const observer = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(listener);
      if (typeof document !== 'undefined') observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
      return () => { off.forEach(dispose => dispose()); observer?.disconnect(); };
    },
  };
}

export function MainPanelList({ source, navigation, renderIcon }: {
  source: ContributionsSource<MainPanelRow>;
  navigation: MainPanelNavigation;
  renderIcon: (id: string, owner: { size: number; active: boolean }) => ReactNode;
}) {
  const rows = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  const { activePanelId } = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot);
  return <>{rows.map(row => <NavigationRow
    key={row.id}
    data-main-panel-navigation={row.id}
    aria-label={row.label}
    title={row.label}
    label={row.label}
    active={activePanelId === row.id}
    disabled={!row.available}
    icon={renderIcon(row.id, { size: 16, active: activePanelId === row.id })}
    onClick={() => navigation.selectPanel(row.id)}
  />)}</>;
}
