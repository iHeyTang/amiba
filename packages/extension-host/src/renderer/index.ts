// packages/extension-host/src/renderer/index.ts
//
// Public API for the renderer side of the extension host.
// Slot-based machinery (slot-registry, slot-outlet, make-renderer-host,
// discover, use-i18n) has been removed — extensions now contribute via
// manifest declarations and render into isolated WebViews.

export { ExtensionWebView } from "./extension-webview";
export {
  desktopBridge,
  maybeDesktopBridge,
  type AmibaRendererBridge,
} from "./bridge";
export {
  useExtensionMains,
  useExtensionSettings,
  type MainContribution,
  type SettingsContribution,
} from "./use-contributes";

// useExtensionRegistry powers the Applet list-detail control surface, including
// persisted rows whose manifest can no longer be discovered.
import { useEffect, useState } from "react";
import type { ExtensionRegistryItem } from "../preload";
import { desktopBridge } from "./bridge";

export interface ExtensionRegistryState {
  items: ExtensionRegistryItem[];
  ready: boolean;
  refreshing: boolean;
}

export function useExtensionRegistry(refreshKey: number = 0) {
  const [state, setState] = useState<ExtensionRegistryState>({
    items: [],
    ready: false,
    refreshing: true,
  });
  useEffect(() => {
    let active = true;
    const { extensions } = desktopBridge();
    setState((current) => ({ ...current, refreshing: true }));
    void extensions
      .listRegistry()
      .then((items) => {
        if (active) setState({ items, ready: true, refreshing: false });
      })
      .catch(() => {
        if (active) {
          setState((current) => ({
            ...current,
            ready: true,
            refreshing: false,
          }));
        }
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);
  return state;
}
