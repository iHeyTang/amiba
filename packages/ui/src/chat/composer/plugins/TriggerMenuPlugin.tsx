import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@amiba/i18n";
import { TriggerMenu } from "../TriggerMenu";
import { TriggerPlugin, type TriggerState } from "./TriggerPlugin";
import { buildProviderRegistry } from "../providers/registry";
import type { ComposerTriggerSession } from "../triggers/session";
import type {
  MenuGroup,
  MenuItem,
  TriggerHitContext,
  TriggerProvider,
} from "../providers/types";

/**
 * The SESSION-LESS mount of Amiba's trigger menu: local detection, the local
 * provider registry, and the shared `TriggerMenu`.
 *
 * The in-session composer mounts `OfficialTriggerPlugin` instead and its menu
 * comes from the shadowed `conversation.input.overlay` seat — so exactly one
 * menu exists per composer, and both render the same component.
 */
export function TriggerMenuPlugin({
  extraProviders,
  sessionId,
  trigger,
}: {
  extraProviders?: TriggerProvider[];
  sessionId?: string;
  trigger: ComposerTriggerSession;
}) {
  const [editor] = useLexicalComposerContext();
  const { t } = useT();
  const registry = useMemo(
    () =>
      buildProviderRegistry(extraProviders ?? [], {
        sessionId,
        claims: trigger.claims,
        revision: trigger.revision,
        sources: trigger.draftSources,
      }),
    [extraProviders, sessionId, trigger],
  );
  const [state, setState] = useState<TriggerState | null>(null);
  const [groups, setGroups] = useState<MenuGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // item -> owning provider, for routing onSelect. Rebuilt per result set.
  const providerByItem = useRef(new Map<MenuItem, TriggerProvider>());
  // The hit the current result set was fetched for; a pick replaces exactly
  // that span, the same CAS material an in-session pick carries.
  const hitRef = useRef<TriggerHitContext | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    if (!state) {
      setGroups([]);
      setError(null);
      setLoading(false);
      hitRef.current = null;
      return;
    }
    const query = state.query;
    const hit: TriggerHitContext = {
      signal: controller.signal,
      position: state.position,
      span: {
        start: state.span.start,
        end: state.span.end,
        draftRev: state.span.draftRev,
      },
    };
    hitRef.current = hit;
    const providers = registry
      .forTrigger(state.trigger)
      .filter((p) => p.match(query) !== false);
    if (providers.length === 0) {
      setGroups([]);
      setError(null);
      setLoading(false);
      setState(null);
      return;
    }
    setLoading(true);
    setError(null);

    Promise.all(
      providers.map((p) => {
        const label = p.group ?? p.id;
        // A provider whose search needs a query but has none: surface its
        // empty-state hint instead of searching (which would return nothing).
        if (!query && p.requiresQuery) {
          const emptyHint = p.emptyHint || t("composer.mention.typeToSearch");
          return Promise.resolve({
            provider: p,
            label,
            items: [] as MenuItem[],
            hint: emptyHint,
          });
        }
        return p.search(query, hit).then(
          (items) => {
            // Persistent categories stay in the menu with no results — show a
            // "no results" empty state rather than dropping the group.
            const emptyHint =
              items.length === 0 && p.persistent
                ? t("composer.mention.noResults")
                : undefined;
            return { provider: p, label, items, hint: emptyHint };
          },
          () => ({ provider: p, label, items: [] as MenuItem[], hint: t("composer.mention.unavailable") }),
        );
      }),
    )
      .then((results) => {
        if (cancelled) return;
        const map = new Map<MenuItem, TriggerProvider>();
        // Cluster by group label, preserving first-seen provider order. Concat
        // items; keep the first hint seen for the group.
        const byLabel = new Map<string, MenuGroup>();
        const order: string[] = [];
        for (const r of results) {
          let g = byLabel.get(r.label);
          if (!g) {
            g = { label: r.label, items: [], hint: undefined };
            byLabel.set(r.label, g);
            order.push(r.label);
          }
          for (const it of r.items) {
            g.items.push(it);
            map.set(it, r.provider);
          }
          if (!g.hint && r.hint) g.hint = r.hint;
        }
        // Keep groups with results OR a hint; drop normal empty ones.
        const built = order
          .map((l) => byLabel.get(l)!)
          .filter((g) => g.items.length > 0 || g.hint);
        providerByItem.current = map;
        setGroups(built);
      })
      .catch(() => {
        if (!cancelled) setError("error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [state, registry, t]);

  function handleSelect(item: MenuItem) {
    providerByItem.current
      .get(item)
      ?.onSelect(item, editor, hitRef.current ?? undefined);
    setState(null);
    setGroups([]);
  }

  return (
    <>
      <TriggerPlugin onTrigger={setState} trigger={trigger} />
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
  );
}
