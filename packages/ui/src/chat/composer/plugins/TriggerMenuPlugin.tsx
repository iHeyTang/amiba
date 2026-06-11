import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { useEffect, useMemo, useState } from "react"
import { TriggerMenu } from "../TriggerMenu"
import { TriggerPlugin, type TriggerState } from "./TriggerPlugin"
import { buildProviderRegistry } from "../providers/registry"
import type { MenuItem, TriggerProvider } from "../providers/types"

interface OwnedItem { item: MenuItem; provider: TriggerProvider }

export function TriggerMenuPlugin({ extraProviders }: { extraProviders?: TriggerProvider[] }) {
  const [editor] = useLexicalComposerContext()
  const registry = useMemo(() => buildProviderRegistry(extraProviders ?? []), [extraProviders])
  const [state, setState] = useState<TriggerState | null>(null)
  const [owned, setOwned] = useState<OwnedItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!state) { setOwned([]); setError(null); setLoading(false); return }
    const providers = registry.forTrigger(state.trigger).filter((p) => p.match(state.query) !== false)
    setLoading(true); setError(null)
    Promise.all(
      providers.map((p) =>
        p.search(state.query).then(
          (items) => items.map((item) => ({ item, provider: p })),
          () => { throw p.id },
        ),
      ),
    )
      .then((lists) => { if (!cancelled) setOwned(lists.flat()) })
      .catch(() => { if (!cancelled) setError("error") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [state, registry])

  function handleSelect(item: MenuItem) {
    const match = owned.find((o) => o.item === item)
    match?.provider.onSelect(item, editor)
    setState(null)
    setOwned([])
  }

  // Cluster items by their provider's group (preserving first-seen group
  // order) so each group is contiguous and TriggerMenu renders one header
  // per group. `groupLabels` is parallel to `items`.
  const { items, groupLabels } = useMemo(() => {
    const byGroup = new Map<string, MenuItem[]>()
    for (const { item, provider } of owned) {
      const g = provider.group ?? provider.id
      const arr = byGroup.get(g)
      if (arr) arr.push(item)
      else byGroup.set(g, [item])
    }
    const flatItems: MenuItem[] = []
    const flatGroups: string[] = []
    for (const [label, arr] of byGroup) {
      for (const it of arr) {
        flatItems.push(it)
        flatGroups.push(label)
      }
    }
    return { items: flatItems, groupLabels: flatGroups }
  }, [owned])

  return (
    <>
      <TriggerPlugin onTrigger={setState} />
      {state && (
        <TriggerMenu
          items={items}
          groupLabels={groupLabels}
          loading={loading}
          error={error}
          onSelect={handleSelect}
          onClose={() => setState(null)}
        />
      )}
    </>
  )
}
