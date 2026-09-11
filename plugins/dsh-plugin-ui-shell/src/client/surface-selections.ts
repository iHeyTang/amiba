import type { StorageAdapter } from "@amiba/app-runtime/platform";
import { resolveSlotLabel } from "@deepseek-ai/dsh-client-ui-slots";
import type { SlotContributionsCtx } from "./session-list-sources.js";
export const SURFACE_SLOTS = [
  "amiba.emptyState.visual",
  "amiba.composer.accessory",
  "amiba.message.decoration",
] as const;
export type SurfaceSlot = (typeof SURFACE_SLOTS)[number];
const key = "ui.surfaceProviders";
export function createSurfaceSelections(
  slots: SlotContributionsCtx,
  storage: StorageAdapter,
) {
  let choices: Partial<Record<SurfaceSlot, string>> = {};
  let error: string | null = null,
    loaded = false;
  let cache:
    | {
        choices: typeof choices;
        rows: Record<SurfaceSlot, { id: string; label: string }[]>;
        error: string | null;
        ready: boolean;
      }
    | undefined;
  let versions = "";
  const listeners = new Set<() => void>();
  const changed = () => {
    cache = undefined;
    listeners.forEach((fn) => fn());
  };
  const loading = storage
    .get([key])
    .then((data) => {
      const value = data[key];
      if (value && typeof value === "object")
        for (const slot of SURFACE_SLOTS) {
          const id = (value as Record<string, unknown>)[slot];
          if (typeof id === "string" && id) choices[slot] = id;
        }
    })
    .catch((e) => {
      error = String(e);
    })
    .finally(() => {
      loaded = true;
      changed();
    });
  let writes = Promise.resolve();
  return {
    getSnapshot() {
      const next = SURFACE_SLOTS.map((s) => slots.getVersion(s)).join(":");
      if (!cache || next !== versions) {
        versions = next;
        const rows = Object.fromEntries(
          SURFACE_SLOTS.map((slot) => [
            slot,
            slots
              .entriesOfSlot(slot)
              .flatMap((e) =>
                e.options.id
                  ? [
                      {
                        id: e.options.id,
                        label:
                          resolveSlotLabel(e.options.label) || e.options.id,
                      },
                    ]
                  : [],
              ),
          ]),
        ) as Record<SurfaceSlot, { id: string; label: string }[]>;
        cache = { choices, rows, error, ready: loaded };
      }
      return cache;
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      const off = SURFACE_SLOTS.map((s) => slots.subscribe(s, () => changed()));
      return () => {
        listeners.delete(fn);
        off.forEach((f) => f());
      };
    },
    set(slot: SurfaceSlot, id: string) {
      const write = async () => {
        await loading;
        const next = { ...choices };
        if (id) next[slot] = id;
        else delete next[slot];
        try {
          await storage.set({ [key]: next });
          choices = next;
          error = null;
          changed();
        } catch (e) {
          error = String(e);
          changed();
          throw e;
        }
      };
      const result = writes.then(write);
      writes = result.catch(() => {});
      return result;
    },
  };
}
export type SurfaceSelections = ReturnType<typeof createSurfaceSelections>;
