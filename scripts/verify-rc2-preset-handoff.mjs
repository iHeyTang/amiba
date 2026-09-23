import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
// Run after pnpm --filter @amiba/dsh-plugin-ui-shell build.
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(root + '/plugins/dsh-plugin-ui-shell/package.json');
assert.equal(require('@deepseek-ai/dsh-client-ui-agent-preset/package.json').version, '0.1.5-rc.2');
const { SlotCore } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-client-ui-slots')));
const { createRegisteredHeroPresetReader } = await import(pathToFileURL(root + '/plugins/dsh-plugin-ui-shell/lib/client/hero-preset-entry.js'));
// Only the observable transport is substituted: the published Node store is
// missing zustand. The published preset controller/apply and SlotCore are real.
const store = { createSnapshotStore(initial) {
  let state = initial; const listeners = new Set();
  return { getSnapshot: () => state, set(next) { state = next; for (const fn of listeners) fn(); }, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
} };
const modules = { react: require('react'), 'react/jsx-runtime': require('react/jsx-runtime'), '@deepseek-ai/dsh-client-ui-primitives': {}, '@deepseek-ai/dsh-client-store': store };
let published;
new Function('window', readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-agent-preset/client'), 'utf8'))({ __ModuleLoader__: { load: ({ factory }) => { published = factory(id => { assert.ok(id in modules, id); return modules[id]; }); } } });
const core = new SlotCore();
core.register({ name: 'root', children: { 'conversation.hero.agentPreset': { kind: 'single', scope: 'root' }, 'conversation.session.header.actions': { kind: 'list', scope: 'session' }, 'settings.section': { kind: 'list', scope: 'root' } } }, () => null);
core.register({ name: 'conversation.hero.agentPreset', priority: 1 }, () => null);
const readers = new Set(), disposers = [];
let sessions = { current: undefined, byId: {} };
const presets = [{ id: 'default', isDefault: true, trust: 'system' }, { id: 'writer', isDefault: false, trust: 'user' }];
const ctx = {
  slots: { register: (...args) => { const off = core.register(...args); disposers.push(off); return off; }, inject: (_name, fn) => fn() },
  locale: { register: () => () => {}, bind: () => value => value },
  effect(fn) { const off = fn(); if (off) disposers.push(off); return off; },
  inject(_deps, fn) { return fn(ctx); }, on: () => () => {},
  remote: { $on: () => () => {}, agentPresets: { list: async () => ({ ok: true, value: { presets, authorable: true, hasDocument: true } }), select: async () => { throw new Error('a correctly composed session needs no second selection'); } } },
  sessions: { list: { getSnapshot: () => sessions, subscribe(fn) { readers.add(fn); return () => readers.delete(fn); } } },
  uiWorkspace: { startSession() {} },
};
published.apply(ctx);
const face = core.entriesOfSlot('conversation.hero.agentPreset')[0].inject();
await face.load(); await face.select('writer');
const read = createRegisteredHeroPresetReader(core);
assert.equal(await read(), 'writer');
// Amiba hands that ID to creation; the official controller consumes its
// private stage on observing the correctly composed blank session.
sessions = { current: 'created', byId: { created: { id: 'created', blank: true, projectionValues: { agentPreset: 'writer' } } } };
for (const fn of readers) fn();
await Promise.resolve();
sessions = { current: undefined, byId: {} };
for (const fn of readers) fn();
assert.equal(await read(), 'default');
for (const dispose of disposers.reverse()) dispose();
assert.equal(await read(), undefined);
assert.equal(readers.size, 0);
console.log('PASS published rc.2 preset controller -> elected slot -> native submission profile -> consumed stage -> next-session default -> unload');
