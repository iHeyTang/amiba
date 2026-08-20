/**
 * The IN-SESSION mount of Amiba's trigger menu.
 *
 * ONE menu component, two mount paths — this is the whole point of the
 * design. `TriggerMenu` renders the pixels, owns the keyboard, and owns the
 * highlight on BOTH paths; only the data source differs:
 *
 *   - here: the official `InputTriggerController.menu` store, reached from
 *     the shadowed `conversation.input.overlay` seat;
 *   - on the home/draft composer and Quick-Ask: the surface-local provider
 *     registry, via `TriggerMenuPlugin`.
 *
 * Because the component is shared, the two paths cannot drift in look,
 * keyboard behaviour, or empty states. What the official path adds is WHO
 * fills the groups: any plugin's `registerSource`, not just Amiba's own.
 */

import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { TriggerMenu } from "../TriggerMenu";
import type { MenuGroup, MenuItem } from "../providers/types";
import type { ComposerTriggerController, MenuState } from "./contracts";

export interface OfficialTriggerMenuProps {
  controller: ComposerTriggerController;
  /** Display label per source name; unlabelled sources show their raw name. */
  labels?: Record<string, string>;
  /** Copy for a group still fetching (the official `pending` status). */
  loadingLabel?: string;
}

export function OfficialTriggerMenu({
  controller,
  labels,
  loadingLabel,
}: OfficialTriggerMenuProps) {
  const subscribe = useCallback(
    (listener: () => void) => controller.menu.subscribe(listener),
    [controller],
  );
  const getSnapshot = useCallback(
    () => controller.menu.getSnapshot(),
    [controller],
  );
  const state: MenuState = useSyncExternalStore(subscribe, getSnapshot);

  // Menu item → (source, index), the two coordinates `controller.pick` wants.
  const routes = useRef(new Map<MenuItem, { source: string; index: number }>());

  const groups = useMemo<MenuGroup[]>(() => {
    const map = new Map<MenuItem, { source: string; index: number }>();
    const built = state.groups.map((group) => ({
      label: labels?.[group.source] ?? group.source,
      items: group.items.map((candidate, index) => {
        const item: MenuItem = {
          id: `${group.source}:${index}:${candidate.name}`,
          label: candidate.name,
          ...(candidate.description !== undefined
            ? { description: candidate.description }
            : {}),
        };
        map.set(item, { source: group.source, index });
        return item;
      }),
      ...(group.status === "pending" && loadingLabel !== undefined
        ? { hint: loadingLabel }
        : {}),
    }));
    routes.current = map;
    // Same shape as the surface-local path: keep groups that have results or
    // an empty-state hint, drop the rest.
    return built.filter((group) => group.items.length > 0 || group.hint);
  }, [labels, loadingLabel, state.groups]);

  const onSelect = useCallback(
    (item: MenuItem) => {
      const route = routes.current.get(item);
      if (route === undefined) return;
      controller.pick(route.source, route.index);
    },
    [controller],
  );

  const onClose = useCallback(() => {
    controller.dismiss();
  }, [controller]);

  if (!state.open) return null;
  return (
    <TriggerMenu
      groups={groups}
      loading={state.groups.every((group) => group.status === "pending")}
      error={null}
      onSelect={onSelect}
      onClose={onClose}
    />
  );
}
