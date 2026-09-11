import type { PresentationCoordinator } from "@amiba/extension-sdk";

interface Entry {
  group: string;
  priority: number;
  active: boolean;
  visible: () => boolean;
  listeners: Set<() => void>;
}
/** A window-wide election with independently visible regional scopes. */
export function createPresentationCoordinator() {
  let visible = true;
  const entries = new Set<Entry>();
  const elect = () => {
    const winners = new Map<string, Entry>();
    if (visible)
      for (const e of entries)
        if (
          e.visible() &&
          (!winners.has(e.group) || winners.get(e.group)!.priority < e.priority)
        )
          winners.set(e.group, e);
    const changed: Entry[] = [];
    for (const e of entries) {
      const active = winners.get(e.group) === e;
      if (active !== e.active) {
        e.active = active;
        changed.push(e);
      }
    }
    changed.forEach((e) => e.listeners.forEach((fn) => fn()));
  };
  const makeCoordinator = (
    eligible: () => boolean,
  ): PresentationCoordinator => ({
    claim(group, priority = 0) {
      if (!group.trim() || !Number.isFinite(priority))
        throw new Error("Invalid presentation claim");
      const e: Entry = {
        group,
        priority,
        active: false,
        visible: eligible,
        listeners: new Set(),
      };
      entries.add(e);
      elect();
      return {
        getSnapshot: () => e.active,
        subscribe: (fn) => {
          e.listeners.add(fn);
          return () => {
            e.listeners.delete(fn);
          };
        },
        release: () => {
          entries.delete(e);
          if (e.active) {
            e.active = false;
            e.listeners.forEach((fn) => fn());
          }
          e.listeners.clear();
          elect();
        },
      };
    },
  });
  return {
    coordinator: makeCoordinator(() => true),
    setVisible(value: boolean) {
      visible = value;
      elect();
    },
    scope() {
      let eligible = true;
      return {
        coordinator: makeCoordinator(() => eligible),
        setVisible(value: boolean) {
          eligible = value;
          elect();
        },
      };
    },
  };
}
