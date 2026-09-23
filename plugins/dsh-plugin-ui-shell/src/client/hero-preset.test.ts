import { expect, it, vi } from 'vitest';
// The published store's Node entry has an undeclared zustand dependency; this
// harness supplies only its observable transport, while testing the real stage logic.
vi.mock('@deepseek-ai/dsh-client-store', () => ({ createSnapshotStore: (initial: unknown) => {
  let value = initial; const listeners = new Set<() => void>();
  const set = (next: unknown) => { value = next; listeners.forEach(fn => fn()); };
  return { getSnapshot: () => value, set, update: (change: (draft: any) => void) => { const next = { ...(value as object) }; change(next); set(next); }, subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); } };
} }));
import { createHeroPreset } from './hero-preset.js';
const presets = [{ id: 'default', trust: 'system' as const, isDefault: true }, { id: 'writer', trust: 'user' as const, isDefault: false }];
it('shares staged selection, preserves it on roster refresh, then resets after handoff', async () => {
  const load = vi.fn(async () => ({ presets, authorable: true, hasDocument: true }));
  const hero = createHeroPreset(load);
  await hero.load();
  expect(hero.store.getSnapshot().current).toBe('default');
  await hero.select('writer');
  await hero.load();
  expect(hero.store.getSnapshot().current).toBe('writer');
  expect(await hero.select('missing')).toBeTruthy();
  expect(hero.store.getSnapshot().current).toBe('writer');
  hero.reset(); expect(hero.store.getSnapshot().current).toBe('default'); await hero.load();
  expect(hero.store.getSnapshot().current).toBe('default');
});
it('retains the staged preset on a failed roster refresh', async () => {
  const load = vi.fn().mockResolvedValueOnce({ presets }).mockRejectedValueOnce(new Error('offline'));
  const hero = createHeroPreset(load);
  await hero.select('writer'); await hero.load();
  expect(hero.store.getSnapshot()).toMatchObject({ current: 'writer', error: 'Error: offline' });
});

it('can retry a synchronous service-not-ready error', async () => {
  const load = vi.fn().mockImplementationOnce(() => { throw new Error('not ready'); }).mockResolvedValue({ presets });
  const hero = createHeroPreset(load);
  await hero.load(); await hero.load();
  expect(hero.store.getSnapshot()).toMatchObject({ current: 'default', error: null });
});

it('captures a submitted choice and does not consume a newer selection', async () => {
  const hero = createHeroPreset(async () => ({ presets }) as never);
  await hero.select('writer');
  const submitted = await hero.prepareSubmission();
  expect(submitted.profileId).toBe('writer');
  await hero.select('default'); await hero.select('writer');
  submitted.commit();
  expect(hero.store.getSnapshot().current).toBe('writer');
  const next = await hero.prepareSubmission(); next.commit();
  expect(hero.store.getSnapshot().current).toBe('default');
});
it('loads the deployment default before an early send and refuses a removed preset', async () => {
  const load = vi.fn().mockResolvedValue({ presets });
  const hero = createHeroPreset(load);
  expect((await hero.prepareSubmission()).profileId).toBe('default');
  await hero.select('writer');
  load.mockResolvedValue({ presets: [presets[0]] });
  await expect(hero.prepareSubmission()).rejects.toThrow('no longer available');
  expect(hero.store.getSnapshot().current).toBe('writer');
});
it('does not invent a preset when the initial roster cannot be loaded', async () => {
  const hero = createHeroPreset(async () => { throw new Error('offline'); });
  await expect(hero.prepareSubmission()).rejects.toThrow('offline');
});

it('passes the elected plugin-owned preset into the handoff instead of the native default', async () => {
  const read = vi.fn(async () => 'plugin-private');
  const hero = createHeroPreset(async () => ({ presets }) as never, read);
  await hero.load();
  expect(hero.store.getSnapshot().current).toBe('default');
  expect((await hero.prepareSubmission()).profileId).toBe('plugin-private');
  expect(read).toHaveBeenCalledOnce();
});
