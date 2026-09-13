import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const requireRoot = createRequire(path.join(root, 'packages/ui/package.json'));
const requireShell = createRequire(path.join(root, 'plugins/dsh-plugin-ui-shell/package.json'));
const cordis = requireShell('@deepseek-ai/cordis');
const slots = requireShell('@deepseek-ai/dsh-client-ui-slots');
const work = await mkdtemp(path.join(tmpdir(), 'amiba-root-providers-'));
after(() => rm(work, { recursive: true, force: true }));
async function patchedPackage(name, requirePackage, files) {
  const installed = path.dirname(requirePackage.resolve(`@deepseek-ai/${name}/package.json`));
  const directory = path.join(work, name);
  for (const file of files) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await writeFile(path.join(directory, file), await readFile(path.join(installed, file)));
  }
  const args = ['--batch', '-p1', '-i', path.join(root, `patches/@deepseek-ai__${name}@0.1.1-rc.2.patch`)];
  const reverse = spawnSync('patch', ['--dry-run', '--reverse', ...args], { cwd: directory, encoding: 'utf8' });
  if (reverse.status !== 0) {
    const apply = spawnSync('patch', ['--forward', ...args], { cwd: directory, encoding: 'utf8' });
    assert.equal(apply.status, 0, apply.stdout + apply.stderr);
  }
  return readFile(path.join(directory, 'lib/client.js'), 'utf8');
}
const runtime = await patchedPackage('dsh-client-runtime', requireShell, ['lib/client.js', 'lib/types/client/slots.d.ts']);
const renderer = await patchedPackage('dsh-client-ui-renderer', requireRoot, ['lib/client.js']);
const start = runtime.indexOf('var SlotRegistry = class');
const end = runtime.indexOf('\n\t\t//#endregion', start);
assert.ok(start >= 0 && end > start);
// Execute the shipped registry, with real Cordis ownership and SlotCore.
const SlotRegistry = new Function('_deepseek_ai_cordis', '_deepseek_ai_dsh_client_ui_slots',
  runtime.slice(start, end) + '\nreturn SlotRegistry;')(cordis, slots);
async function fixture(t) {
  const ctx = new cordis.Context();
  const service = await ctx.plugin(SlotRegistry);
  t.after(() => service.dispose());
  let registry;
  const access = await ctx.inject(['slots'], child => { registry = child.slots; });
  t.after(() => access.dispose());
  return { ctx, registry, source: registry._rootSource };
}
const source = { getSnapshot: () => ({ activePanelId: 'conversation' }), subscribe: () => () => {} };

test('publishes atomically and rejects hook, keyed-hook and prop name collisions without notifying', async t => {
  const { registry, source: rootSource } = await fixture(t);
  let notices = 0;
  const unsubscribe = rootSource.subscribe(() => notices++);
  const remove = registry.provideRoot({ hooks: { panelInfo: source }, props: { layoutVersion: 1 } });
  const committed = rootSource.getSnapshot();
  assert.equal(committed.hooks.panelInfo, source);
  assert.equal(committed.props.layoutVersion, 1);
  for (const contribution of [
    { hooks: { panelInfo: source } },
    { keyedHooks: { panelInfo: () => source } },
    { props: { usePanelInfo: 1 } },
    { hooks: { free: source }, props: { useFree: 1 } },
    { hooks: { sessions: source } },
    { props: { useWorkspaces: null } },
  ]) {
    assert.throws(() => registry.provideRoot(contribution), /duplicate root standard prop/);
    assert.equal(rootSource.getSnapshot(), committed);
    assert.equal(notices, 1);
  }
  remove();
  assert.equal(rootSource.getSnapshot().hooks.panelInfo, undefined);
  assert.equal(notices, 2);
  remove();
  assert.equal(notices, 2);
  unsubscribe();
  registry.provideRoot({ props: { afterUnsubscribe: true } });
  assert.equal(notices, 2);
});

test('caller fiber unload removes only its own sources and permits replacement', async t => {
  const { ctx, registry, source: rootSource } = await fixture(t);
  registry.provideRoot({ props: { retained: true } });
  const plugin = await ctx.inject(['slots'], child => {
    child.slots.provideRoot({ hooks: { panelInfo: source } });
  });
  assert.equal(rootSource.getSnapshot().hooks.panelInfo, source);
  await plugin.dispose();
  assert.equal(rootSource.getSnapshot().hooks.panelInfo, undefined);
  assert.equal(rootSource.getSnapshot().props.retained, true);
  const remove = registry.provideRoot({ hooks: { panelInfo: source } });
  assert.equal(rootSource.getSnapshot().hooks.panelInfo, source);
  remove();
});

test('a failing observer cannot prevent subsequent observers or corrupt registration', async t => {
  const { registry, source: rootSource } = await fixture(t);
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args));
  let notices = 0;
  rootSource.subscribe(() => { throw new Error('observer failure'); });
  rootSource.subscribe(() => notices++);
  const remove = registry.provideRoot({ props: { value: 1 } });
  assert.equal(rootSource.getSnapshot().props.value, 1);
  remove();
  assert.equal(notices, 2);
  assert.equal(errors.length, 2);
});

const requireUi = createRequire(path.join(root, 'packages/ui/package.json'));
const requireRenderer = createRequire(requireRoot.resolve('@deepseek-ai/dsh-client-ui-renderer/package.json'));
const React = requireUi('react');
const { createRoot } = requireUi('react-dom/client');
const { JSDOM } = requireUi('jsdom');
function between(source, first, last) {
  const a = source.indexOf(first), b = source.indexOf(last, a);
  assert.ok(a >= 0 && b > a, first);
  return source.slice(a, b);
}
const actualHelpers = [
  between(renderer, 'function bindSnapshotSelector(', '\n\t\t//#endregion'),
  between(renderer, 'function observableHook(', '\n\t\tfunction SessionMaybeProvider('),
  between(renderer, 'const rootKeyedHookCache =', '\n\t\tfunction standardKit('),
].join('\n');
const { standardProps, useRootBinding } = new Function('react', 'import_with_selector',
  'const noopSubscribe = () => () => {}; class SlotAssemblyError extends Error {}\n' + actualHelpers +
  '\nreturn {standardProps, useRootBinding};')(React, requireRenderer('use-sync-external-store/shim/with-selector'));
function observable(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => value,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    set(next) { value = next; for (const listener of [...listeners]) listener(); },
    get subscriptions() { return listeners.size; },
  };
}

test('real React consumers observe roster and source changes, retain draft DOM, and release keyed subscriptions', async t => {
  const dom = new JSDOM('<div id="root"></div>');
  const globals = { window: globalThis.window, document: globalThis.document, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let mountedRoot;
  t.after(async () => {
    if (mountedRoot) await React.act(() => mountedRoot.unmount());
    dom.window.close();
    Object.assign(globalThis, globals);
  });
  const { registry, source: rootSource } = await fixture(t);
  const sessions = observable({ current: 'session-a' }), workspaces = observable([]);
  const host = { root: rootSource, sessions: { list: sessions }, workspaces: { list: workspaces } };
  const original = standardProps(host, 'root');
  const panel = observable('conversation'), a = observable('A'), b = observable('B');
  let selectedKey = 'a';
  const info = { sessionId: 'session-a', hooks: {}, props: {} };
  function Values({ scope }) {
    useRootBinding(host);
    const props = standardProps(host, scope, scope === 'root' ? undefined : info);
    // The optional domain consumer is a separate component so adding/removing a
    // provider never conditionally calls hooks within an existing component.
    return React.createElement('section', { 'data-scope': scope },
      React.createElement('input', { defaultValue: 'draft' }),
      props.usePanelInfo && React.createElement(Panel, { usePanel: props.usePanelInfo, useItem: props.useItem }));
  }
  function Panel({ usePanel, useItem }) {
    return React.createElement('output', null, `${usePanel(value => value)}:${useItem(selectedKey, value => value)}`);
  }
  const mount = mountedRoot = createRoot(dom.window.document.getElementById('root'));
  const draw = () => React.createElement(React.Fragment, null, ...['root', 'session', 'session-maybe'].map(scope => React.createElement(Values, { key: scope, scope })));
  await React.act(() => mount.render(draw()));
  const input = dom.window.document.querySelector('input');
  input.value = 'unsent draft';
  let remove;
  await React.act(() => { remove = registry.provideRoot({ hooks: { panelInfo: panel }, keyedHooks: { item: key => key === 'a' ? a : b } }); });
  assert.deepEqual([...dom.window.document.querySelectorAll('output')].map(node => node.textContent), ['conversation:A', 'conversation:A', 'conversation:A']);
  assert.equal(a.subscriptions, 3);
  assert.equal(standardProps(host, 'root').useSessions, original.useSessions);
  assert.equal(standardProps(host, 'root').useWorkspaces, original.useWorkspaces);
  await React.act(() => panel.set('tools'));
  assert.equal(dom.window.document.querySelector('output').textContent, 'tools:A');
  selectedKey = 'b';
  await React.act(() => mount.render(draw()));
  assert.equal(a.subscriptions, 0);
  assert.equal(b.subscriptions, 3);
  assert.equal(dom.window.document.querySelector('output').textContent, 'tools:B');
  await React.act(() => remove());
  assert.equal(panel.subscriptions, 0);
  assert.equal(b.subscriptions, 0);
  assert.equal(dom.window.document.querySelector('output'), null);
  assert.equal(dom.window.document.querySelector('input'), input);
  assert.equal(input.value, 'unsent draft');
  const replacement = observable('replacement');
  await React.act(() => registry.provideRoot({ hooks: { panelInfo: replacement }, keyedHooks: { item: () => a } }));
  assert.equal(dom.window.document.querySelector('output').textContent, 'replacement:A');
  assert.equal(dom.window.document.querySelector('input'), input);
  await React.act(() => mount.unmount());
  mountedRoot = undefined;
  assert.equal(replacement.subscriptions, 0);
  assert.equal(a.subscriptions, 0);
});
