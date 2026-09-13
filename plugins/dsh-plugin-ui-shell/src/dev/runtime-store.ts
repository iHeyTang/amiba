import { readFileSync } from 'node:fs';
import * as cordis from '@deepseek-ai/cordis';
import * as slots from '@deepseek-ai/dsh-client-ui-slots';

// Execute the complete installed ModuleLoader factory. Extracting lexical
// declarations alone would omit imperative Immer initialization (array traps).
const source = readFileSync('node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js', 'utf8');
let runtime: Pick<typeof import('@deepseek-ai/dsh-client-runtime/client'), 'defineStore'> | undefined;
Function('window', source)({ __ModuleLoader__: {
  load(module: { factory(require: (id: string) => unknown): typeof runtime }) {
    runtime = module.factory(id => {
      if (id === '@deepseek-ai/cordis') return cordis;
      if (id === '@deepseek-ai/dsh-client-ui-slots') return slots;
      throw new Error(`Unexpected runtime dependency: ${id}`);
    });
  },
} });
if (!runtime) throw new Error('Installed runtime did not register its module');
export const { defineStore } = runtime;
