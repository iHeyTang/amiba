import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { AgentPresetSeatState, AgentPresetSeatInjected } from '@deepseek-ai/dsh-client-ui-agent-preset/client';
import type { getPlatform } from '@amiba/app-runtime/platform';
type AgentPresetsAdapter = NonNullable<ReturnType<typeof getPlatform>["agentPresets"]>;

/** One staged selection shared by the native picker and official seat components. */
export function createHeroPreset(loadRoster: () => ReturnType<AgentPresetsAdapter['list']>) {
  const store = createSnapshotStore<AgentPresetSeatState>({ options: [], current: '', error: null, busy: false, introduce: false });
  let staged = false;
  let fallback = '';
  let pending: Promise<void> | undefined;
  const injected: AgentPresetSeatInjected = {
    hooks: { agentPresetSeat: store },
    load: () => pending ?? (pending = Promise.resolve().then(async () => {
      try {
        const { presets } = await loadRoster();
        fallback = presets.find(p => p.isDefault)?.id ?? presets[0]?.id ?? '';
        const state = store.getSnapshot();
        store.set({ ...state, options: presets, error: null, current: staged ? state.current : fallback });
      } catch (error) { store.update(state => { state.error = String(error); }); }
    }).finally(() => { pending = undefined; })),
    async select(id) {
      if (!store.getSnapshot().options.length) await injected.load();
      if (!store.getSnapshot().options.some(p => p.id === id)) return 'Unknown agent preset';
      staged = true;
      store.update(state => { state.current = id; state.error = null; });
    },
    introduced() { store.update(state => { state.introduce = false; }); },
  };
  return { ...injected, store, reset() { staged = false; store.update(state => { state.current = fallback; state.error = null; }); void injected.load(); } };
}
export type HeroPreset = ReturnType<typeof createHeroPreset>;

declare module "@deepseek-ai/cordis" { interface Context { heroAgentPreset: HeroPreset } }
