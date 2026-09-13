import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import * as React from 'react';
import type { HostObservable, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots';
import type { KeyedSnapshotSelectorHook } from '../client/sidebar-right/contract/keyed-snapshot.js';
import { extractBundleClosure } from '../../scripts/extract-bundle-closure.mjs';

// Exercise the installed, patched rc.2 renderer's real selector and keyed
// source bindings. No mock React subscription implementation is substituted.
const requireUi = createRequire(resolve('../../packages/ui/package.json'));
const source = readFileSync(join(dirname(requireUi.resolve('@deepseek-ai/dsh-client-ui-renderer/package.json')), 'lib/client.js'), 'utf8');
const closure = extractBundleClosure(source, ['bindSnapshotSelector', 'rootKeyedObservableHook']);
const bindings = Function('require', `${closure};return {bindSnapshotSelector,rootKeyedObservableHook};`)((id: string) => {
  if (id === 'react') return React;
  throw new Error(`Unexpected renderer binding dependency: ${id}`);
}) as {
  bindSnapshotSelector<T>(source: HostObservable<T>): SnapshotSelectorHook<T>;
  rootKeyedObservableHook<T>(source: (key: string) => HostObservable<T> | undefined): KeyedSnapshotSelectorHook<T>;
};
export const bindSnapshotSelector = bindings.bindSnapshotSelector;
export const keyedObservableHook = bindings.rootKeyedObservableHook;
