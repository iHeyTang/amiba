import type {} from "@deepseek-ai/dsh-settings";
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { MediaOperation } from './contracts.js';
export interface MediaSelection { provider: string; model: string; protocol: string }
export type MediaDefaults = Partial<Record<MediaOperation, MediaSelection>>;
const NS = 'amiba-media-defaults';
const selection = z.object({ provider: z.string().required(), model: z.string().required(), protocol: z.string().required() });
export class MediaPreferences {
  constructor(private readonly ctx: Context) {
    ctx.settings.register(NS, z.object({ confirmationThresholdCny: z.number().default(1), defaults: z.dict(selection).default({}), disabledModels: z.array(z.string()).default([]) }), { base: { defaults: {} } });
  }
  snapshot() {
    const descriptor = this.ctx.settings.describe().find(row => row.ns === NS);
    if (!descriptor) throw new Error('Media defaults are unavailable');
    const value = this.ctx.settings.get(NS) as { defaults: MediaDefaults; disabledModels?: string[]; confirmationThresholdCny?: number };
    return { confirmationThresholdCny: value.confirmationThresholdCny ?? 1, defaults: value.defaults, disabledModels: value.disabledModels ?? [], revision: descriptor.revision };
  }
  isEnabled(provider: string, model: string) {
    return !this.snapshot().disabledModels.includes(JSON.stringify([provider, model]));
  }
  async setThreshold(value: number, revision: number) {
    if (!Number.isFinite(value) || value <= 0 || value > 1000) throw new Error('Threshold must be between 0 and 1000 CNY');
    await this.ctx.settings.mutate(NS, [{op:'set',path:['confirmationThresholdCny'],value}], revision);
  }
  async setEnabled(provider: string, model: string, enabled: boolean, revision: number) {
    const snapshot = this.snapshot();
    const key = JSON.stringify([provider, model]);
    const disabledModels = snapshot.disabledModels.filter(value => value !== key);
    if (!enabled) disabledModels.push(key);
    const ops: Array<{op: 'set'; path: string[]; value: string[]} | {op: 'unset'; path: string[]}> =
      [{op:'set',path:['disabledModels'],value:disabledModels}];
    if (!enabled) for (const [operation, value] of Object.entries(snapshot.defaults)) {
      if (value?.provider === provider && value.model === model) ops.push({op:'unset',path:['defaults',operation]});
    }
    await this.ctx.settings.mutate(NS, ops, revision);
    return this.snapshot();
  }
  async set(operation: MediaOperation, value: MediaSelection | null, revision: number) {
    await this.ctx.settings.mutate(NS, [value ? { op: 'set', path: ['defaults', operation], value } : { op: 'unset', path: ['defaults', operation] }], revision);
    return this.snapshot();
  }
}
