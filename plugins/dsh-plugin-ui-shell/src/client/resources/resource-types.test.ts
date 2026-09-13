import { expectTypeOf, it } from 'vitest';
import type { PropsRuntime, SlotRendererHost, RootStandardSourceContribution, ResourceProtocolMap } from '@deepseek-ai/dsh-client-ui-slots';
import type { ResourceProvider, ResourceSnapshot } from './contract.js';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap { counter: number }
}

it('exports a typed protocol map and preserves the existing renderer host contract', () => {
  expectTypeOf<ResourceProtocolMap['counter']>().toEqualTypeOf<number>();
  expectTypeOf<ResourceProvider<'counter'>['open']>().returns.toEqualTypeOf<AsyncIterable<RemoteResult<number>>>();
  expectTypeOf<SlotRendererHost['sessions']>().not.toBeAny();
  expectTypeOf<RootStandardSourceContribution['hooks']>().not.toBeAny();
});

// Compile the actual slot-facing generic hook, not a parallel local signature.
export function checkSlotResourceTypes(props: PropsRuntime<'root'>) {
  const value = props.useResource<'counter'>('dsh-resource://counter/one');
  expectTypeOf(value).toEqualTypeOf<ResourceSnapshot<number>>();
}
