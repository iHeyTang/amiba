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

  return (
    <>
      <TriggerPlugin onTrigger={setState} />
      {state && (
        <TriggerMenu
          items={owned.map((o) => o.item)}
          loading={loading}
          error={error}
          onSelect={handleSelect}
          onClose={() => setState(null)}
        />
      )}
    </>
  )
}
