import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { useEffect, useMemo, useRef, useState } from "react"
import { useT } from "@amiba/i18n"
import { TriggerMenu } from "../TriggerMenu"
import { TriggerPlugin, type TriggerState } from "./TriggerPlugin"
import { buildProviderRegistry } from "../providers/registry"
import type { MenuGroup, MenuItem, TriggerProvider } from "../providers/types"

export function TriggerMenuPlugin({ extraProviders }: { extraProviders?: TriggerProvider[] }) {
  const [editor] = useLexicalComposerContext()
  const { t } = useT()
  const registry = useMemo(() => buildProviderRegistry(extraProviders ?? []), [extraProviders])
  const [state, setState] = useState<TriggerState | null>(null)
  const [groups, setGroups] = useState<MenuGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // item -> owning provider, for routing onSelect. Rebuilt per result set.
  const providerByItem = useRef(new Map<MenuItem, TriggerProvider>())

  useEffect(() => {
    let cancelled = false
    if (!state) { setGroups([]); setError(null); setLoading(false); return }
    const query = state.query
    const providers = registry.forTrigger(state.trigger).filter((p) => p.match(query) !== false)
    setLoading(true); setError(null)

    Promise.all(
      providers.map((p) => {
        const label = p.group ?? p.id
        // A provider whose search needs a query but has none: surface its
        // empty-state hint instead of searching (which would return nothing).
        if (!query && p.requiresQuery) {
          const hint = p.emptyHint || t("composer.mention.typeToSearch")
          return Promise.resolve({ provider: p, label, items: [] as MenuItem[], hint })
        }
        return p.search(query).then(
          (items) => {
            // Persistent categories stay in the menu with no results — show a
            // "no results" empty state rather than dropping the group.
            const hint =
              items.length === 0 && p.persistent
                ? t("composer.mention.noResults")
                : undefined
            return { provider: p, label, items, hint }
          },
          () => { throw p.id },
        )
      }),
    )
      .then((results) => {
        if (cancelled) return
        const map = new Map<MenuItem, TriggerProvider>()
        // Cluster by group label, preserving first-seen provider order. Concat
        // items; keep the first hint seen for the group.
        const byLabel = new Map<string, MenuGroup>()
        const order: string[] = []
        for (const r of results) {
          let g = byLabel.get(r.label)
          if (!g) { g = { label: r.label, items: [], hint: undefined }; byLabel.set(r.label, g); order.push(r.label) }
          for (const it of r.items) { g.items.push(it); map.set(it, r.provider) }
          if (!g.hint && r.hint) g.hint = r.hint
        }
        // Keep groups with results OR a hint; drop normal empty ones.
        const built = order.map((l) => byLabel.get(l)!).filter((g) => g.items.length > 0 || g.hint)
        providerByItem.current = map
        setGroups(built)
      })
      .catch(() => { if (!cancelled) setError("error") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [state, registry, t])

  function handleSelect(item: MenuItem) {
    providerByItem.current.get(item)?.onSelect(item, editor)
    setState(null)
    setGroups([])
  }

  return (
    <>
      <TriggerPlugin onTrigger={setState} />
      {state && (
        <TriggerMenu
          groups={groups}
          loading={loading}
          error={error}
          onSelect={handleSelect}
          onClose={() => setState(null)}
        />
      )}
    </>
  )
}
