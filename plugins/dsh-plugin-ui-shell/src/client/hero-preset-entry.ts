import type { AgentPresetSeatInjected } from '@deepseek-ai/dsh-client-ui-agent-preset/client';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';

type SeatRegistry = { entriesOfSlot(name: string): readonly StoredEntry[] };
/** Read the elected root entry's published AgentPresetSeatInjected face.
 * The entry keeps ownership of its controller. No private field is changed and
 * no subscription outlives it. In particular this accepts the official
 * plugin's own seat store; it need not inject Amiba's heroAgentPreset service.
 */
export function createRegisteredHeroPresetReader(slots: SeatRegistry) {
  const faces = new WeakMap<StoredEntry, AgentPresetSeatInjected | null>();
  return async (): Promise<string | undefined> => {
    // A plugin can unload while its roster request is in flight. Never submit
    // the now-invisible selection; retry against the newly elected occupant.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const entry = slots.entriesOfSlot('conversation.hero.agentPreset')[0];
      if (!entry?.inject) return undefined;
      if (!faces.has(entry)) {
        const injected = entry.inject();
        const candidate = injected as Partial<AgentPresetSeatInjected>;
        const store = candidate.hooks?.agentPresetSeat;
        faces.set(entry, typeof candidate.load === 'function' && typeof candidate.select === 'function'
          && typeof store?.getSnapshot === 'function' && typeof store.subscribe === 'function'
          ? candidate as AgentPresetSeatInjected : null);
      }
      const face = faces.get(entry);
      if (!face) return undefined;
      await face.load();
      if (slots.entriesOfSlot('conversation.hero.agentPreset')[0] !== entry) continue;
      const state = face.hooks.agentPresetSeat.getSnapshot();
      if (state.busy) throw new Error('Agent preset selection is still in progress');
      if (!state.current || !state.options.some(option => option.id === state.current)) {
        throw new Error(state.error ?? 'Selected agent preset is no longer available');
      }
      return state.current;
    }
    throw new Error('Agent preset picker changed while preparing the conversation; please retry');
  };
}
