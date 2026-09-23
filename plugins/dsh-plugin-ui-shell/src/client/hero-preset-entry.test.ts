import { expect, it, vi } from 'vitest';
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots';
import { createRegisteredHeroPresetReader } from './hero-preset-entry.js';

function setup() {
  const core = new SlotCore();
  core.register({ name: 'root', children: { 'conversation.hero.agentPreset': { kind: 'single', scope: 'root' } } }, () => null);
  core.register({ name: 'conversation.hero.agentPreset', priority: 1 }, () => null);
  return { core, read: createRegisteredHeroPresetReader(core) };
}
function seat() {
  const state = { current: 'private-writer', options: [{ id: 'private-writer' }], busy: false, error: null };
  return { state, face: { hooks: { agentPresetSeat: { getSnapshot: () => state, subscribe: () => () => {} } }, load: vi.fn(async () => {}), select: vi.fn(async () => {}), introduced() {} } };
}
it('consumes the elected plugin-owned official face without an Amiba service or priority override', async () => {
  const { core, read } = setup();
  expect(await read()).toBeUndefined();
  const { face, state } = seat();
  const inject = vi.fn(() => face);
  const off = core.register({ name: 'conversation.hero.agentPreset', inject }, () => null);
  expect(await read()).toBe('private-writer');
  state.current = 'private-next'; state.options = [{ id: 'private-next' }];
  expect(await read()).toBe('private-next');
  expect(inject).toHaveBeenCalledOnce();
  expect(face.select).not.toHaveBeenCalled();
  off();
  expect(await read()).toBeUndefined();
});
it('does not submit a plugin selection that unloaded during its asynchronous load', async () => {
  const { core, read } = setup();
  const { face } = seat();
  let finish!: () => void;
  face.load.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const off = core.register({ name: 'conversation.hero.agentPreset', inject: () => face }, () => null);
  const pending = read(); off(); finish();
  expect(await pending).toBeUndefined();
});
it('refuses a busy or removed selection and follows error abdication back to native', async () => {
  const { core, read } = setup();
  const { face, state } = seat();
  core.register({ name: 'conversation.hero.agentPreset', inject: () => face }, () => null);
  state.busy = true;
  await expect(read()).rejects.toThrow('in progress');
  state.busy = false; state.options = [];
  await expect(read()).rejects.toThrow('no longer available');
  const entry = core.entriesOfSlot('conversation.hero.agentPreset')[0]!;
  core.reportEntryError('conversation.hero.agentPreset', entry, new Error('broken plugin'), { abdicate: true });
  expect(await read()).toBeUndefined();
});
