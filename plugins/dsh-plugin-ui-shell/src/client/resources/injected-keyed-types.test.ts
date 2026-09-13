import { expectTypeOf, it } from 'vitest';
import type { HostObservable, InjectFace, KeyedSnapshotSelectorHook, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots';

it('maps entry keyed sources to typed selector hooks while preserving ordinary and business props', () => {
  type Face = InjectFace<{
    note: string;
    hooks: { fixed: HostObservable<boolean> };
    keyedHooks: { item: (key: string) => HostObservable<{ count: number }> | undefined };
  }>;
  expectTypeOf<Face['useItem']>().toEqualTypeOf<KeyedSnapshotSelectorHook<{ count: number }>>();
  expectTypeOf<Face['useFixed']>().toEqualTypeOf<SnapshotSelectorHook<boolean>>();
  expectTypeOf<Face['note']>().toEqualTypeOf<string>();
  expectTypeOf<keyof Face>().toEqualTypeOf<'note' | 'useItem' | 'useFixed'>();
  type KeyedOnly = InjectFace<{ keyedHooks: { value: (key: string) => HostObservable<number> } }>;
  expectTypeOf<KeyedOnly['useValue']>().toEqualTypeOf<KeyedSnapshotSelectorHook<number>>();
});
