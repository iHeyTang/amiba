import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { ComponentType, ReactNode } from "react";

import type { ConnectAdapter } from "./adapter.js";
import type { ConnectWizardKit } from "./wizard-kit.js";
import type { ConnectView } from "../types.js";

/** Provider-owned settings receive only their explicit public projection. */
export interface ConnectSettingsHost {
  connect: ConnectView;
  settings: Record<string, unknown>;
  save(patch: Record<string, unknown>): Promise<void>;
}

/** One agent preset offered by the chrome's preset picker. */
export interface PresetOption {
  id: string;
  label: string;
  isDefault: boolean;
}

/**
 * The only surface a provider wizard depends on. The wizard fills the whole
 * seat it is mounted in — settings dialog or conversation seat — and draws
 * its own header, form (incl. connect name + agent preset) and buttons.
 */
export interface ConnectWizardHost {
  providerId: string;
  presets: PresetOption[];
  /** Suggested values from the caller (the chat tool's args); the wizard seeds its own fields with them. */
  prefill?: { name?: string; agentPreset?: string };
  adapter: ConnectAdapter;
  kit: ConnectWizardKit;
  /** Return to an in-flow platform chooser; absent in a settings modal. */
  back?(): void;
  done(connect: ConnectView): void;
  cancel(): void;
}

/** A provider's registry contribution: its wizard and provider-owned detail copy. */
export interface ConnectorUIContribution {
  component: ComponentType<{ host: ConnectWizardHost }>;
  /**
   * Provider-specific overview rendered inside connector-core's detail-page
   * shell. Keeping this as a component lets the provider plugin own its copy,
   * translations and capability vocabulary without moving product knowledge
   * into connector-core.
   */
  details?: ComponentType;
  settings?: ComponentType<{ host: ConnectSettingsHost }>;
  icon?: ReactNode;
  tagline?: string;
}

/**
 * Client-side registry of provider wizards, provided by connector-core's
 * client half as the `amibaConnectorUI` Cordis service (see index.tsx) and
 * consumed by each provider plugin's client half. Mirrors the custom-service
 * pattern ui-shell uses for `layout` (`ctx.reflect.provide("layout", …)`).
 */
export interface ConnectorUIRegistry {
  register(providerId: string, entry: ConnectorUIContribution): () => void;
  get(providerId: string): ConnectorUIContribution | undefined;
  list(): string[];
  subscribe(listener: () => void): () => void;
}

export function createConnectorUIRegistry(): ConnectorUIRegistry {
  const entries = new Map<string, ConnectorUIContribution>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    register(providerId, entry) {
      if (entries.has(providerId)) {
        throw new Error(`duplicate connect wizard for provider ${providerId}`);
      }
      entries.set(providerId, entry);
      notify();
      return () => {
        if (entries.get(providerId) === entry) {
          entries.delete(providerId);
          notify();
        }
      };
    },
    get: (providerId) => entries.get(providerId),
    list: () => [...entries.keys()],
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Subscribes a component to the registry's membership, returning the ids that
 * currently have a wizard. This is what makes `registry.subscribe` matter: a
 * provider plugin's client half registers from its own `apply`, which can
 * settle after the connect settings page (and its modal) already mounted, and
 * a wizard is disposed when its plugin unloads. Without this, both surfaces
 * would snapshot the registry at mount and silently miss every later change.
 *
 * `useSyncExternalStore` demands a snapshot that is stable under `Object.is`
 * between notifications, so the store value is the joined id string (provider
 * ids never contain spaces) and the array is derived from it — returning
 * `registry.list()` directly would hand back a fresh array every render and
 * spin forever.
 */
export function useConnectorUIProviderIds(
  registry: ConnectorUIRegistry,
): string[] {
  const subscribe = useCallback(
    (listener: () => void) => registry.subscribe(listener),
    [registry],
  );
  const getSnapshot = useCallback(() => registry.list().join(" "), [registry]);
  const key = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return useMemo(() => (key ? key.split(" ") : []), [key]);
}
