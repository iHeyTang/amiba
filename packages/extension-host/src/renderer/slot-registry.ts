import type { Disposable, SlotEntry, SlotName } from "@hermes-x/extension-api"

type Listener = () => void

export interface SlotRegistry {
  register<P>(slot: SlotName, entry: SlotEntry<P>): Disposable
  get<P>(slot: SlotName): ReadonlyArray<SlotEntry<P>>
  subscribe(cb: Listener): Disposable
}

export function createSlotRegistry(): SlotRegistry {
  const slots = new Map<SlotName, Array<SlotEntry<unknown>>>()
  const listeners = new Set<Listener>()

  function notify() {
    for (const l of listeners) l()
  }

  return {
    register<P>(slot: SlotName, entry: SlotEntry<P>): Disposable {
      const list = (slots.get(slot) ?? []) as Array<SlotEntry<unknown>>
      list.push(entry as SlotEntry<unknown>)
      list.sort((a, b) => a.order - b.order)
      slots.set(slot, list)
      notify()
      return {
        dispose: () => {
          const cur = slots.get(slot)
          if (!cur) return
          const i = cur.indexOf(entry as SlotEntry<unknown>)
          if (i >= 0) cur.splice(i, 1)
          notify()
        },
      }
    },
    get<P>(slot: SlotName): ReadonlyArray<SlotEntry<P>> {
      return (slots.get(slot) ?? []) as ReadonlyArray<SlotEntry<P>>
    },
    subscribe(cb: Listener): Disposable {
      listeners.add(cb)
      return { dispose: () => listeners.delete(cb) }
    },
  }
}
