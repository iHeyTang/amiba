import type {
  PlatformAdapter,
  StorageAdapter,
  StorageChangeMap,
} from "../platform/index.js";

import type { DshApiClient } from "./index.js";
import { createDshPlatformAdapters } from "./platform-adapters.js";

const PREFIX = "amiba.preference.";
const CHANGE_EVENT = "amiba:web-storage-changed";

function keyOf(name: string): string {
  return `${PREFIX}${name}`;
}

function read(name: string): unknown {
  const source = localStorage.getItem(keyOf(name));
  if (source === null) return undefined;
  try {
    return JSON.parse(source) as unknown;
  } catch {
    return undefined;
  }
}

function webStorage(): StorageAdapter {
  return {
    async get(keys) {
      const names =
        keys === undefined
          ? Array.from({ length: localStorage.length }, (_, index) =>
              localStorage.key(index),
            )
              .filter((key): key is string => !!key?.startsWith(PREFIX))
              .map((key) => key.slice(PREFIX.length))
          : Array.isArray(keys)
            ? keys
            : [keys];
      return Object.fromEntries(names.map((name) => [name, read(name)]));
    },
    async set(patch) {
      const changes: StorageChangeMap = {};
      for (const [name, value] of Object.entries(patch)) {
        const oldValue = read(name);
        if (JSON.stringify(oldValue) === JSON.stringify(value)) continue;
        localStorage.setItem(keyOf(name), JSON.stringify(value));
        changes[name] = { oldValue, newValue: value };
      }
      if (Object.keys(changes).length) {
        window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: changes }));
      }
    },
    async remove(keys) {
      const changes: StorageChangeMap = {};
      for (const name of Array.isArray(keys) ? keys : [keys]) {
        const oldValue = read(name);
        if (oldValue === undefined) continue;
        localStorage.removeItem(keyOf(name));
        changes[name] = { oldValue };
      }
      if (Object.keys(changes).length) {
        window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: changes }));
      }
    },
    watch(keys, listener) {
      const filter = keys === undefined ? null : new Set(Array.isArray(keys) ? keys : [keys]);
      const publish = (changes: StorageChangeMap) => {
        const selected = Object.fromEntries(
          Object.entries(changes).filter(([name]) => !filter || filter.has(name)),
        );
        if (Object.keys(selected).length) listener(selected);
      };
      const onLocal = (event: Event) => {
        const detail = (event as CustomEvent<StorageChangeMap>).detail;
        if (detail) publish(detail);
      };
      const onStorage = (event: StorageEvent) => {
        if (!event.key?.startsWith(PREFIX)) return;
        const name = event.key.slice(PREFIX.length);
        const parse = (value: string | null) => {
          if (value === null) return undefined;
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return undefined;
          }
        };
        publish({
          [name]: {
            oldValue: parse(event.oldValue),
            newValue: parse(event.newValue),
          },
        });
      };
      window.addEventListener(CHANGE_EVENT, onLocal);
      window.addEventListener("storage", onStorage);
      return () => {
        window.removeEventListener(CHANGE_EVENT, onLocal);
        window.removeEventListener("storage", onStorage);
      };
    },
  };
}

/** Same-origin browser surface over the same DSH APIs used by Electron. */
export function createWebPlatformAdapter(client: DshApiClient): PlatformAdapter {
  return {
    kind: "web",
    storage: webStorage(),
    shell: {
      async openExternal(url) {
        window.open(url, "_blank", "noopener,noreferrer");
      },
    },
    ...createDshPlatformAdapters(client),
  };
}
