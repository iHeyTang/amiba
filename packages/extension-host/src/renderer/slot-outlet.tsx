// packages/extension-host/src/renderer/slot-outlet.tsx
import { createContext, useContext, useEffect, useState, type ReactElement } from "react"
import type { SlotEntry, SlotName } from "@hermes-x/extension-api"
import type { SlotRegistry } from "./slot-registry"

const SlotRegistryContext = createContext<SlotRegistry | null>(null)

export function SlotRegistryProvider(props: {
  registry: SlotRegistry
  children: React.ReactNode
}): ReactElement {
  return (
    <SlotRegistryContext.Provider value={props.registry}>
      {props.children}
    </SlotRegistryContext.Provider>
  )
}

export function useSlotRegistry(): SlotRegistry {
  const reg = useContext(SlotRegistryContext)
  if (!reg) throw new Error("useSlotRegistry requires <SlotRegistryProvider>")
  return reg
}

function useSlotEntries<P>(slot: SlotName): ReadonlyArray<SlotEntry<P>> {
  const reg = useContext(SlotRegistryContext)
  if (!reg) throw new Error("SlotOutlet requires <SlotRegistryProvider>")
  const [entries, setEntries] = useState<ReadonlyArray<SlotEntry<P>>>(reg.get<P>(slot))
  useEffect(() => {
    setEntries(reg.get<P>(slot))
    const sub = reg.subscribe(() => setEntries(reg.get<P>(slot)))
    return () => sub.dispose()
  }, [reg, slot])
  return entries
}

/**
 * Multi-instance outlet: renders all entries in `order`. Pass `runtimeProps`
 * to forward host-supplied props (e.g. composer state) to every entry.
 */
export function SlotOutlet<P extends Record<string, unknown> = Record<string, unknown>>(
  props: { name: SlotName; runtimeProps?: P },
): ReactElement {
  const entries = useSlotEntries<P>(props.name)
  return (
    <>
      {entries.map((e) => {
        const Component = e.component
        const merged = { ...(e.props ?? {}), ...(props.runtimeProps ?? {}) } as unknown as P
        return <Component key={`${e.extensionId}:${e.entryId}`} {...merged} />
      })}
    </>
  )
}

/**
 * Single-instance outlet: renders the entry whose entryId matches `activeId`.
 * Used for `sidebar.view` (one view shown at a time, switched by ActivityBar).
 */
export function SingleSlotOutlet<P extends Record<string, unknown> = Record<string, unknown>>(
  props: { name: SlotName; activeId: string | null; runtimeProps?: P },
): ReactElement | null {
  const entries = useSlotEntries<P>(props.name)
  if (props.activeId == null) return null
  const match = entries.find((e) => e.entryId === props.activeId)
  if (!match) return null
  const Component = match.component
  return <Component {...({ ...(match.props ?? {}), ...(props.runtimeProps ?? {}) } as unknown as P)} />
}
