import type { ComponentType, ReactNode } from "react";

import type { ConnectAdapter } from "./adapter.js";
import type { ConnectView } from "../types.js";

/** One agent preset offered by the chrome's preset picker. */
export interface PresetOption {
  id: string;
  label: string;
  isDefault: boolean;
}

/**
 * The only surface a provider wizard body depends on. The chrome builds one
 * and passes it as the sole prop, so the body works identically whether it is
 * mounted in the settings modal (Phase A) or the conversation composer (Phase
 * B). The body drives creation itself — `adapter.create` for a manual flow, or
 * the onboarding trio for a scan flow — then calls `done`.
 */
export interface ConnectWizardHost {
  providerId: string;
  connectName: string;
  agentPreset: string;
  adapter: ConnectAdapter;
  done(connect: ConnectView): void;
  cancel(): void;
}

/** A provider's registry contribution: its wizard body plus picker chrome. */
export interface ConnectWizardEntry {
  component: ComponentType<{ host: ConnectWizardHost }>;
  icon?: ReactNode;
  tagline?: string;
}

/**
 * Client-side registry of provider wizards, provided by connector-core's
 * client half as the `amibaConnectWizards` Cordis service (see index.tsx) and
 * consumed by each provider plugin's client half. Mirrors the custom-service
 * pattern ui-shell uses for `layout` (`ctx.reflect.provide("layout", …)`).
 */
export interface ConnectWizardRegistry {
  register(providerId: string, entry: ConnectWizardEntry): () => void;
  get(providerId: string): ConnectWizardEntry | undefined;
  list(): string[];
  subscribe(listener: () => void): () => void;
}

export function createConnectWizardRegistry(): ConnectWizardRegistry {
  const entries = new Map<string, ConnectWizardEntry>();
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
      return () => listeners.delete(listener);
    },
  };
}
