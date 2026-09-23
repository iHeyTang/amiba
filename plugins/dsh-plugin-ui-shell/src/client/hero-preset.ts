import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { AgentPresetSeatState, AgentPresetSeatInjected } from '@deepseek-ai/dsh-client-ui-agent-preset/client';
import type { getPlatform } from '@amiba/app-runtime/platform';
type AgentPresetsAdapter = NonNullable<ReturnType<typeof getPlatform>["agentPresets"]>;

/** One staged selection shared by the native picker and official seat components. */
export function createHeroPreset(loadRoster: () => ReturnType<AgentPresetsAdapter['list']>, readRegisteredSelection?: () => Promise<string | undefined>) {
  const store = createSnapshotStore<AgentPresetSeatState>({ options: [], current: '', error: null, busy: false, introduce: false });
  let staged = false;
  let revision = 0;
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
      revision += 1;
      staged = true;
      store.update(state => { state.current = id; state.error = null; });
    },
    introduced() { store.update(state => { state.introduce = false; }); },
  };
  function reset() {
    revision += 1;
    staged = false;
    store.update(state => { state.current = fallback; state.error = null; state.introduce = false; });
    void injected.load();
  }
  return {
    ...injected, store, reset,
    /** Capture the choice before asynchronous handoff; consume only that revision. */
    async prepareSubmission() {
      const registered = await readRegisteredSelection?.();
      if (registered === undefined) await injected.load();
      const state = store.getSnapshot();
      if (registered === undefined && (!state.current || !state.options.some(option => option.id === state.current))) {
        throw new Error(state.error ?? 'Selected agent preset is no longer available');
      }
      const submittedRevision = revision;
      return {
        profileId: registered ?? state.current,
        commit() { if (revision === submittedRevision) reset(); },
      };
    },
  };
}
export type HeroPreset = ReturnType<typeof createHeroPreset>;

declare module "@deepseek-ai/cordis" { interface Context { heroAgentPreset: HeroPreset } }
